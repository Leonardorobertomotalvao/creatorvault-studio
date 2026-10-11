# Componentes externos

O código do CreatorVault Studio e seu launcher são distribuídos sob a licença MIT, em LICENSE.

A versão portátil inclui Node.js 24.21.0 para Windows x64, obtido diretamente de nodejs.org e verificado por SHA-256. O arquivo runtime/LICENSE contém integralmente as licenças e os avisos dos componentes dessa distribuição. Fonte e distribuição: https://nodejs.org/dist/v24.21.0/.

yt-dlp, FFmpeg e FFprobe não estão incluídos neste ZIP nem no código do CreatorVault. O botão de instalação os obtém diretamente dos respectivos distribuidores no computador do usuário e verifica os checksums publicados antes da instalação.

- yt-dlp: https://github.com/yt-dlp/yt-dlp. A licença de seu código e a dos executáveis empacotados diferem; consulte os avisos e licenças da distribuição obtida.
- FFmpeg/FFprobe Essentials para Windows: https://www.gyan.dev/ffmpeg/builds/, distribuidor listado em https://ffmpeg.org/download.html. Os avisos do pacote são conservados em tools/ffmpeg-info quando disponíveis.

As licenças desses componentes continuam aplicáveis independentemente da licença MIT do CreatorVault. Ao redistribuir um pacote com ferramentas adicionadas, cumpra os termos de cada distribuição.
