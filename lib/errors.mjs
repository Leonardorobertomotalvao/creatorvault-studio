export function downloadError(raw = '') {
  const text = String(raw);
  if (/could not copy.*cookie|failed to decrypt|decrypt.*cookie|DPAPI|cookie database/i.test(text)) return {
    code: 'COOKIE_ACCESS', status: 'auth_required', pauseQueue: true,
    message: 'Não foi possível ler os cookies do navegador. Feche as janelas desse navegador e teste novamente. Se persistir, importe cookies.txt nas configurações.',
  };
  if (/sign in to confirm|not a bot|login required|sign in|cookies.*authentication|age.restricted/i.test(text)) return {
    code: 'AUTH_REQUIRED', status: 'auth_required', pauseQueue: true,
    message: 'O YouTube exige confirmação de acesso. Abra o vídeo no navegador e conclua a verificação. Depois configure os cookies em Configurações, teste o acesso e tente novamente.',
  };
  if (/429|too many requests|rate.?limit|this content isn't available, try again later/i.test(text)) return {
    code: 'RATE_LIMIT', status: 'blocked', pauseQueue: true,
    message: 'O serviço limitou as solicitações. A fila foi pausada. Aguarde antes de tentar novamente.',
  };
  if (/requested format.*not available|no video formats/i.test(text)) return {code:'FORMAT_UNAVAILABLE',status:'failed',message:'Essa qualidade não está disponível. Tente novamente usando Melhor disponível.'};
  if (/ENOENT|ffmpeg.*not found|ffprobe.*not found|no supported JavaScript runtime|unrecognized arguments|unsupported.*js-runtimes|n challenge solving failed/i.test(text)) return {code:'TOOLS_MISSING',status:'failed',message:'Uma ferramenta está ausente ou desatualizada. Use Instalar / atualizar ferramentas nas configurações.'};
  if (/ENOSPC|no space left|disk.*full/i.test(text)) return {code:'DISK_FULL',status:'failed',message:'Não há espaço suficiente no destino. Libere espaço ou escolha outra pasta nas configurações.'};
  if (/EACCES|EPERM|permission denied|access.*denied/i.test(text)) return {code:'PERMISSION',status:'failed',message:'Sem permissão para gravar no destino. Escolha uma pasta acessível nas configurações.'};
  return {code:'DOWNLOAD_FAILED',status:'failed',message:text.trim().slice(-900) || 'Não foi possível concluir. Consulte os detalhes técnicos.'};
}
