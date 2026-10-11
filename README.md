# CreatorVault Studio

Gerenciador local de mídia para Windows: downloads autorizados, arquivos próprios, projetos e cortes de vídeo. Interface em português, executável Windows x64 e processamento no computador.

## Abrir o aplicativo

1. Extraia **todo o ZIP** em uma pasta como `E:\CreatorVaultStudio`. Não execute dentro do ZIP nem copie somente o executável.
2. Abra **CreatorVaultStudio.exe**. Node.js portátil acompanha o pacote; não precisa instalar Node.js no Windows.
3. No primeiro uso, o painel abre **Configurações**. Clique em **Instalar / atualizar ferramentas** e aguarde. O aplicativo obtém yt-dlp, FFmpeg e FFprobe diretamente dos distribuidores e verifica seus checksums.
4. Acesse **Downloads**, informe o link, escolha a qualidade e adicione à fila.

É necessário Windows 10/11 x64 e internet para obter ferramentas e mídia online. Os arquivos do aplicativo ficam na pasta extraída. A ferramenta não precisa de privilégios de administrador.

O pacote portátil não inclui yt-dlp nem FFmpeg. A instalação inicial usa internet e baixa aproximadamente 110 MB para o FFmpeg, além do yt-dlp. Se você já tem esses executáveis, pode copiá-los para `tools` antes de abrir o aplicativo.

## Quando o YouTube pede confirmação

A versão 1.6 trata a mensagem de confirmação de acesso de forma explícita e pausa a fila, evitando repetir o mesmo erro nos outros itens.

1. Clique em **Ver fonte**, abra o vídeo no navegador e conclua qualquer verificação oferecida pelo YouTube.
2. Em **Configurações → Acesso ao YouTube**, escolha **Usar cookies do navegador deste PC** e selecione o navegador em que abriu o vídeo. Pode informar o perfil, como `Default` ou `Profile 1`.
3. Salve a autenticação e use **Testar acesso (sem baixar)** com o mesmo link.
4. Se o teste confirmar o acesso, volte à tarefa e clique em **Tentar novamente**.

Se o navegador impedir a leitura dos cookies, feche suas janelas e teste novamente. Se a proteção de criptografia continuar impedindo a leitura, use um `cookies.txt` no formato Netscape exportado do YouTube. A importação descarta cookies de outros domínios e guarda os cookies do YouTube somente em `data/private/youtube-cookies.txt`.

O aplicativo não pede senha, não envia cookies para este repositório e não contém cookies na distribuição. Evite compartilhar `data`, arquivos de cookies ou seu histórico pessoal. Os cookies configurados são utilizados nas solicitações ao YouTube, tanto na análise quanto no download.

O YouTube pode exigir login, desafio adicional ou limitar solicitações mesmo com cookies. Nenhuma atualização do aplicativo pode garantir que um serviço externo nunca fará essas exigências. A documentação oficial do yt-dlp explica os procedimentos de cookies e suas limitações:

- https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp
- https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies

## Organização e progresso

- Qualidades até 4K, 1440p, 1080p, 720p, 480p e extração MP3.
- Projetos, biblioteca pesquisável, importação de arquivos próprios e recortes locais.
- Contagem de bytes, porcentagem da etapa, velocidade e tempo restante quando fornecidos pelo downloader.
- Barra indeterminada durante preparação ou estimativas sem porcentagem; a barra não fica cheia quando o progresso é zero.
- Tarefas equivalentes por links curtos, Shorts ou links watch são reconhecidas para prevenir duplicatas.
- A fila usa ordem de chegada e pausa diante de confirmação de acesso ou limite do serviço. A retomada é manual.
- O estado **Concluído** exige processo bem-sucedido e arquivo final encontrado. Arquivo existente com erro posterior é marcado **Verificar arquivo**.

Você pode escolher a pasta de destino em Configurações. No Windows, a seleção inicial procura E:, F:, G: e D: antes da pasta Vídeos do usuário. Arquivos já registrados continuam no local original; eles não são movidos quando o destino é alterado.

## Migrar da versão 1.5

Feche o aplicativo antigo, extraia a nova versão em outra pasta e copie a pasta **data** antiga para a nova **antes** de abrir. Guarde a versão antiga até confirmar o histórico e os arquivos. Os caminhos dos vídeos continuam apontando para o lugar original.

A versão 1.6 transforma falhas antigas de confirmação de acesso em tarefas que pedem autenticação. Ela conserva o restante do histórico. Se o banco não puder ser lido, a inicialização falha com uma orientação de recuperação e preserva o arquivo em vez de sobrescrevê-lo com um banco vazio.

## Encerrar e diagnosticar

Use **Encerrar aplicativo** no painel. Fechar somente a aba mantém o serviço local em execução. Antes de encerrar, aguarde ou cancele downloads, cortes e instalações em andamento. O encerramento aguarda a gravação pendente do histórico.

Abrir o executável novamente na mesma pasta reaproveita a instância ativa. O launcher escolhe uma porta livre e identifica o serviço da própria instância; uma porta ocupada não impede a inicialização.

- `logs/launcher.log`: diagnóstico do início do aplicativo.
- **Detalhes técnicos** da tarefa: saída limitada do downloader.
- `INICIAR_CREATORVAULT.bat`: alternativa com console para diagnóstico.
- `CRIAR_ATALHO.bat`: cria um atalho para o executável.
- `INSTALAR_FERRAMENTAS.bat`: alternativa ao instalador do painel.

## Desenvolver e gerar o executável

O servidor e a interface não têm dependências npm. Para desenvolver, use Node.js 22 ou superior:

```sh
npm test
npm start
```

O launcher é escrito em Go. No Windows, com Node.js e Go 1.24 ou superior disponíveis:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1
```

O script executa os testes, compila o launcher como aplicativo GUI Windows x64, inclui Node.js portátil com licença e checksum verificado, e gera `dist/CreatorVault_Studio_v1.6.0_Windows_x64.zip` e `dist/SHA256SUMS.txt`.

O workflow `.github/workflows/build.yml` executa os testes no Linux e Windows, verifica a interface com Playwright, compila o pacote e testa a inicialização e o encerramento do executável no runner Windows. As capturas da interface e os ZIPs ficam nos artefatos do workflow. Uma tag que corresponda à versão, como `v1.6.0`, também publica uma release com o ZIP.

## Validação desta alteração

29 testes automatizados passaram no ambiente Linux, cobrindo autenticação, importação de cookies, pausa e retomada, duplicatas, progresso, conclusão, recorte, origem da API, porta ocupada, banco inválido e encerramento. O launcher foi compilado e confirmado como **PE32+ GUI Windows x64**, com análise estática Go aprovada. A execução nativa do launcher depende do teste Windows do workflow; ela não foi executada no ambiente Linux.

Os downloads dos testes usam uma ferramenta simulada. A autenticação real do YouTube e a leitura de cookies no seu Windows dependem da sessão, do navegador e das regras atuais do serviço.

## Licenças

O CreatorVault e o launcher usam a licença MIT. As licenças de Node.js e de ferramentas externas continuam aplicáveis. Consulte `THIRD_PARTY_NOTICES.md` e `runtime/LICENSE` no pacote portátil.

Use mídia própria, licenciada ou cuja obtenção esteja permitida. O aplicativo não remove DRM e não é afiliado ao YouTube. O executável não é assinado digitalmente.
