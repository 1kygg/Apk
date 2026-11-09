export function inviteLink(code:string):string{
  const normalized=code.trim();
  if(!/^[a-zA-Z0-9_-]{20,200}$/.test(normalized))throw new Error('Código de convite inválido.');
  return 'consta://invite/'+normalized;
}
export function parseInvite(value:string):string|null{
  const raw=value.trim();
  if(/^[a-zA-Z0-9_-]{20,200}$/.test(raw))return raw;
  try{
    const url=new URL(raw);
    if(url.protocol!=='consta:'||url.hostname!=='invite')return null;
    const code=url.pathname.replace(/^\//,'')||url.searchParams.get('code')||'';
    return /^[a-zA-Z0-9_-]{20,200}$/.test(code)?code:null;
  }catch{return null;}
}
