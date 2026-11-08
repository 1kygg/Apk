function minutes(value:string){
  const match=/^(\d{2}):(\d{2})$/.exec(value);
  if(!match)throw new Error('Use horários no formato HH:MM.');
  const h=Number(match[1]),m=Number(match[2]);
  if(h>23||m>59)throw new Error('Horário inválido.');
  return h*60+m;
}
export function isQuietTime(hour:number,minute:number,start?:string,end?:string){
  if(!start||!end)return false;
  const a=minutes(start),b=minutes(end),value=hour*60+minute;
  return a===b?true:a<b?value>=a&&value<b:value>=a||value<b;
}
