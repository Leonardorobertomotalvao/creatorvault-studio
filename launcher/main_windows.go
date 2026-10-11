//go:build windows

package main

import (
	"bufio"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

var user32 = syscall.NewLazyDLL("user32.dll")
var shell32 = syscall.NewLazyDLL("shell32.dll")
var kernel32 = syscall.NewLazyDLL("kernel32.dll")

type session struct {
	URL      string `json:"url"`
	Instance string `json:"instance"`
}

func alert(message string) {
	title, _ := syscall.UTF16PtrFromString("CreatorVault Studio")
	body, _ := syscall.UTF16PtrFromString(message)
	user32.NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(body)), uintptr(unsafe.Pointer(title)), 0x30)
}
func openBrowser(address string) error {
	verb, _ := syscall.UTF16PtrFromString("open")
	uri, _ := syscall.UTF16PtrFromString(address)
	result, _, _ := shell32.NewProc("ShellExecuteW").Call(0, uintptr(unsafe.Pointer(verb)), uintptr(unsafe.Pointer(uri)), 0, 0, 1)
	if result <= 32 {
		return fmt.Errorf("não foi possível abrir o navegador (código %d)", result)
	}
	return nil
}
func validSession(s session) bool {
	u, e := url.Parse(s.URL)
	if e != nil || u.Scheme != "http" || u.Hostname() != "127.0.0.1" || u.Port() == "" || s.Instance == "" {
		return false
	}
	client := http.Client{Timeout: 800 * time.Millisecond}
	resp, e := client.Get(s.URL + "/api/health")
	if e != nil {
		return false
	}
	defer resp.Body.Close()
	var health struct {
		App      string `json:"app"`
		Instance string `json:"instance"`
	}
	e = json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&health)
	return e == nil && resp.StatusCode == 200 && health.App == "creatorvault-studio" && health.Instance == s.Instance
}
func readSession(file string) (session, bool) {
	var s session
	b, e := os.ReadFile(file)
	if e != nil || json.Unmarshal(b, &s) != nil {
		return s, false
	}
	return s, validSession(s)
}
func main() {
	exe, e := os.Executable()
	if e != nil {
		alert(e.Error())
		return
	}
	root := filepath.Dir(exe)
	if _, e = os.Stat(filepath.Join(root, "server.mjs")); e != nil {
		alert("Extraia o ZIP completo. server.mjs não foi encontrado.")
		return
	}
	logDir := filepath.Join(root, "logs")
	if e = os.MkdirAll(logDir, 0755); e != nil {
		alert("Sem permissão para gravar nesta pasta. Extraia o aplicativo em uma pasta sua, por exemplo E:\\CreatorVaultStudio.")
		return
	}
	sessionFile := filepath.Join(logDir, "app-session.json")
	digest := sha256.Sum256([]byte(strings.ToLower(root)))
	mutexName, _ := syscall.UTF16PtrFromString("Local\\CreatorVault-" + hex.EncodeToString(digest[:12]))
	handle, _, mutexError := kernel32.NewProc("CreateMutexW").Call(0, 1, uintptr(unsafe.Pointer(mutexName)))
	if handle == 0 {
		alert("Não foi possível reservar a instância do aplicativo.")
		return
	}
	defer kernel32.NewProc("CloseHandle").Call(handle)
	if mutexError == syscall.Errno(183) {
		for i := 0; i < 40; i++ {
			if s, ok := readSession(sessionFile); ok {
				if e = openBrowser(s.URL); e != nil {
					alert(e.Error())
				}
				return
			}
			time.Sleep(200 * time.Millisecond)
		}
		alert("O aplicativo ainda está iniciando. Aguarde e tente abrir novamente.")
		return
	}
	defer kernel32.NewProc("ReleaseMutex").Call(handle)
	node := filepath.Join(root, "runtime", "node.exe")
	if stat, err := os.Stat(node); err != nil || stat.IsDir() {
		node, e = exec.LookPath("node.exe")
		if e != nil {
			alert("Node.js portátil não foi encontrado. Extraia o ZIP completo, incluindo a pasta runtime.")
			return
		}
	}
	check := exec.Command(node, "-p", "process.versions.node.split('.')[0]")
	check.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	version, err := check.Output()
	var major int
	fmt.Sscanf(strings.TrimSpace(string(version)), "%d", &major)
	if err != nil || major < 22 {
		alert("Este aplicativo precisa de Node.js 22 ou superior. Use o runtime que acompanha a versão portátil.")
		return
	}
	logfile, e := os.OpenFile(filepath.Join(logDir, "launcher.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if e != nil {
		alert("Não foi possível gravar logs: " + e.Error())
		return
	}
	defer logfile.Close()
	id := make([]byte, 16)
	if _, e = rand.Read(id); e != nil {
		alert(e.Error())
		return
	}
	instance := hex.EncodeToString(id)
	cmd := exec.Command(node, filepath.Join(root, "server.mjs"))
	cmd.Dir = root
	cmd.Env = append(os.Environ(), "CV_NO_BROWSER=1", "CV_APP_MODE=launcher", "CV_INSTANCE_ID="+instance, "PORT=0")
	cmd.Stderr = logfile
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	stdout, e := cmd.StdoutPipe()
	if e != nil {
		alert(e.Error())
		return
	}
	if e = cmd.Start(); e != nil {
		alert("Não foi possível iniciar: " + e.Error())
		return
	}
	ready := make(chan session, 1)
	exited := make(chan error, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 4096), 128*1024)
		for scanner.Scan() {
			line := scanner.Text()
			fmt.Fprintln(logfile, line)
			if strings.HasPrefix(line, "CV_READY:") {
				var s session
				if json.Unmarshal([]byte(strings.TrimPrefix(line, "CV_READY:")), &s) == nil && s.Instance == instance {
					select {
					case ready <- s:
					default:
					}
				}
			}
		}
	}()
	go func() { exited <- cmd.Wait() }()
	var current session
	select {
	case current = <-ready:
	case err = <-exited:
		alert("O aplicativo não iniciou. Consulte logs\\launcher.log. " + fmt.Sprint(err))
		return
	case <-time.After(25 * time.Second):
		_ = cmd.Process.Kill()
		<-exited
		alert("Tempo de inicialização excedido. Consulte logs\\launcher.log.")
		return
	}
	if !validSession(current) {
		_ = cmd.Process.Kill()
		<-exited
		alert("Não foi possível confirmar o serviço local.")
		return
	}
	b, _ := json.Marshal(current)
	if e = os.WriteFile(sessionFile, b, 0600); e != nil {
		fmt.Fprintln(logfile, "Aviso ao salvar sessão:", e)
	}
	defer os.Remove(sessionFile)
	if os.Getenv("CV_NO_BROWSER") != "1" {
		if e = openBrowser(current.URL); e != nil {
			alert(e.Error() + ". Endereço local: " + current.URL)
		}
	}
	if e = <-exited; e != nil {
		alert("O serviço foi interrompido. Consulte logs\\launcher.log.")
	}
}
