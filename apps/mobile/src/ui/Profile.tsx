import React,{useEffect,useState} from 'react';
import {Image,View} from 'react-native';
import {api} from '../lib/api';
import {logout,deleteAccount} from '../lib/auth';
import {pickAvatar,openPrivacySettings} from '../lib/device';
import {cancelReminders,scheduleReminders} from '../lib/notifications';
import {configuration} from '../lib/config';
import {Button,Choice,Field,Loading,Notice,Row,Screen,Section,Sheet,Txt,confirmAction,useAction,useResource,useTheme} from './components';
import {PreferencesForm} from './Preferences';
import {days,Preferences} from './types';
import {Notifications} from './Ranking';
import {removeDraft,loadDrafts} from './trainingStore';

type Me={id:string;displayName:string;avatarUrl?:string;onboardingComplete?:boolean};
type Reminder={enabled:boolean;days:number[];hour:number;minute:number;quietStartMinute:number;quietEndMinute:number};
function toClock(n:number){return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');}
function toMinute(v:string){if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(v))throw new Error('Use horário no formato HH:mm, por exemplo 08:30.');const [h,m]=v.split(':').map(Number);return h*60+m;}
export function Profile({onPreferencesChanged}:{onPreferencesChanged:()=>void}){
 const profile=useResource<Me>('/me'),preferences=useResource<Preferences>('/me/preferences'),reminders=useResource<Reminder>('/me/notifications');
 const [editPreferences,setEditPreferences]=useState(false),[displayName,setDisplayName]=useState(''),[reminderEnabled,setReminderEnabled]=useState(false),[reminderDays,setReminderDays]=useState<number[]>([]),[time,setTime]=useState('08:00'),[quietStart,setQuietStart]=useState('22:00'),[quietEnd,setQuietEnd]=useState('07:00'),[privacy,setPrivacy]=useState(false),[feedback,setFeedback]=useState<string|null>(null);
 const action=useAction(),theme=useTheme();
 useEffect(()=>{if(profile.data)setDisplayName(profile.data.displayName);},[profile.data?.displayName]);
 useEffect(()=>{if(reminders.data){const r=reminders.data;setReminderEnabled(r.enabled);setReminderDays(r.days);setTime(toClock(r.hour*60+r.minute));setQuietStart(toClock(r.quietStartMinute));setQuietEnd(toClock(r.quietEndMinute));}},[reminders.data]);
 async function saveName(){await action.run(async()=>{if(displayName.trim().length<2)throw new Error('Use um nome de exibição com pelo menos 2 caracteres.');await api('/me',{method:'PATCH',body:{displayName:displayName.trim()}});await profile.reload();setFeedback('Nome atualizado. Seu e-mail não aparece aos participantes.');});}
 async function avatar(){await action.run(async()=>{const url=await pickAvatar();if(url){await profile.reload();setFeedback('Avatar atualizado.');}});}
 async function saveReminders(){await action.run(async()=>{const minute=toMinute(time),start=toMinute(quietStart),end=toMinute(quietEnd);if(reminderEnabled&&!reminderDays.length)throw new Error('Escolha ao menos um dia para os lembretes.');if(reminderEnabled)await scheduleReminders({enabled:true,days:reminderDays,hour:Math.floor(minute/60),minute:minute%60,quietStart,quietEnd});else await cancelReminders();await api('/me/notifications',{method:'PATCH',body:{enabled:reminderEnabled,days:reminderDays,hour:Math.floor(minute/60),minute:minute%60,quietStartMinute:start,quietEndMinute:end}});setFeedback(reminderEnabled?'Lembretes locais salvos neste aparelho.':'Lembretes desativados neste aparelho.');});}
 function removeAccount(){confirmAction('Excluir sua conta e seus dados?','O servidor excluirá perfil, atividades e dados associados. Não é possível desfazer. Dados locais deste aparelho também serão removidos.',async()=>{await action.run(async()=>{const id=profile.data?.id;await deleteAccount();if(id)for(const d of await loadDrafts())if(d.userId===id)await removeDraft(d.planId,id);});},true);}
 if(editPreferences&&preferences.data)return <PreferencesForm initial={preferences.data} onBack={()=>setEditPreferences(false)} onSaved={()=>{setEditPreferences(false);void preferences.reload();onPreferencesChanged();}}/>;
 return <Screen title="Perfil" subtitle="Sua conta, seu ritmo e sua privacidade." onRefresh={async()=>{await Promise.all([profile.reload(),preferences.reload(),reminders.reload()]);}} refreshing={profile.loading}>
  {profile.loading?<Loading/>:profile.error?<Notice error>{profile.error}</Notice>:<>
   {profile.data?.avatarUrl&&<Image source={{uri:profile.data.avatarUrl}} accessibilityLabel="Seu avatar" style={{width:80,height:80,borderRadius:40}}/>}
   <Field label="Nome de exibição" value={displayName} onChangeText={setDisplayName}/><Button title="Salvar nome" variant="quiet" onPress={saveName} busy={action.busy}/><Button title="Escolher avatar pelo seletor do sistema" variant="quiet" onPress={avatar} busy={action.busy}/>
  </>}
  <Section title="Treinos e agenda pessoal">{preferences.error&&<Notice error>{preferences.error}</Notice>}<Button title="Atualizar preferências e exercícios evitados" variant="quiet" disabled={!preferences.data} onPress={()=>setEditPreferences(true)}/><Txt muted>A agenda pessoal organiza sugestões e lembretes. Ela não muda o calendário nem a pontuação dos desafios do grupo.</Txt></Section>
  <Section title="Lembretes deste aparelho">{reminders.loading?<Loading/>:reminders.error?<Notice error>{reminders.error}</Notice>:null}<Choice title="Ativar lembretes" selected={reminderEnabled} onPress={()=>setReminderEnabled(v=>!v)}/><Row>{days.map((d,i)=><Choice key={d} title={d} selected={reminderDays.includes(i+1)} onPress={()=>setReminderDays(a=>a.includes(i+1)?a.filter(x=>x!==i+1):[...a,i+1])}/>)}</Row><Field label="Horário preferido (HH:mm)" value={time} onChangeText={setTime} keyboardType="numbers-and-punctuation"/><Field label="Início do silêncio (HH:mm)" value={quietStart} onChangeText={setQuietStart} keyboardType="numbers-and-punctuation"/><Field label="Fim do silêncio (HH:mm)" value={quietEnd} onChangeText={setQuietEnd} keyboardType="numbers-and-punctuation"/><Button title="Salvar lembretes" variant="quiet" onPress={saveReminders} busy={action.busy}/><Txt muted>Permissão de notificações só é solicitada ao ativar. Nenhuma mensagem de culpa ou cobrança é enviada.</Txt></Section>
  <Section title="Aparência"><Choice title="Tema claro" selected={theme.isLight} onPress={theme.toggle}/><Txt muted>O aplicativo respeita a escala de fontes do sistema e usa transições discretas sem animações obrigatórias.</Txt></Section>
  <Section title="Integrações e permissões"><Txt>Google: {configuration.googleConfigured?'configuração informada':'configuração externa pendente'}</Txt><Txt muted>Passos são opcionais, consultados na tela Atividades. A origem e a disponibilidade aparecem após a consulta nativa. Não há necessidade de smartwatch.</Txt><Button title="Gerenciar permissões nas configurações" variant="quiet" onPress={()=>action.run(openPrivacySettings)}/><Button title="Consultar privacidade e revogação" variant="quiet" onPress={()=>setPrivacy(true)}/></Section>
  <Notifications/>
  {feedback&&<Notice>{feedback}</Notice>}{action.error&&<Notice error>{action.error}</Notice>}
  <Button title="Sair da conta" variant="quiet" busy={action.busy} onPress={()=>confirmAction('Sair da conta?','Registros pendentes ficam vinculados à sua conta neste aparelho. Sincronize as atividades importantes antes de sair.',async()=>{await action.run(logout);})}/>
  <Button title="Excluir conta e dados" variant="danger" onPress={removeAccount} busy={action.busy}/>
  <Sheet title="Privacidade e permissões" visible={privacy} onClose={()=>setPrivacy(false)}>
   <Section title="Dados privados por padrão"><Txt>Trajetos e dados detalhados de saúde não são publicados nos grupos. Compartilhar quilômetros no ranking não compartilha seu percurso.</Txt><Txt>O compartilhamento é opcional. Quando você incluir um percurso local, poderá ocultar o início e o fim. Isso reduz exposição, sem garantir anonimato.</Txt></Section>
   <Section title="Você controla as permissões"><Txt>Localização é usada apenas no registro de percurso iniciado por você. A permissão de segundo plano é solicitada somente se você ativar a continuidade com a tela bloqueada.</Txt><Txt>Passos e atividade física são opcionais. Negar ou revogar acesso não impede treinos, grupos ou registros manuais.</Txt><Txt>Notificações podem ser desativadas aqui e nas configurações do sistema. Para interromper o uso de passos, desative a opção antes da sessão e revogue a permissão de atividade física/saúde no sistema.</Txt><Txt>O avatar usa o seletor de fotos do sistema. Câmera, microfone, contatos e fotos de comprovação não são exigidos.</Txt><Button title="Abrir configurações de permissões" variant="quiet" onPress={()=>action.run(openPrivacySettings)}/></Section>
   <Section title="Excluir e sincronizar"><Txt>Você pode excluir atividades no histórico e a conta nesta tela. A exclusão recalcula resultados no servidor. Registros offline ficam pendentes até haver conexão; eles podem ser preservados no histórico e inelegíveis para pontuação quando o horário não puder ser validado.</Txt><Txt>O mapa pode depender de internet ou cache. O fechamento forçado do aplicativo pode interromper o GPS; dados do período perdido não são inventados.</Txt></Section>
   <Section title="Uso dos dados"><Txt>Dados de saúde não são usados para publicidade. O app não registra tokens ou trajetos em logs de diagnóstico. Os dados enviados ao servidor são limitados ao necessário para histórico, autenticação e classificação.</Txt></Section>
  </Sheet>
 </Screen>;
}
