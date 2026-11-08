import React,{useEffect,useState} from 'react';
import {AppState,View} from 'react-native';
import {api} from '../lib/api';
import {shareInvite} from '../lib/device';
import {Button,Choice,Empty,Field,Loading,Notice,Row,Screen,Section,Sheet,Txt,confirmAction,useAction,useResource} from './components';
import {ChallengeForm,challengeTypeLabels} from './ChallengeForm';
import {Challenge,days,Group,Invite,localDate,Member,modalityLabels,sourceLabels} from './types';

type RankingResult={items:{userId:string;displayName:string;position:number;total:number;weeksMet:number}[];updatedAt:string;unit:string;maximum:{total:number;unit:string;weeks:{weekStart:string;regularDates:string[];maximum:number}[]}};
type Notification={id:string;title:string;message:string;createdAt:string;readAt?:string};
export function Notifications(){
 const resource=useResource<{items:Notification[]}>('/notifications'),action=useAction();
 const unread=resource.data?.items.filter(n=>!n.readAt)||[];
 return <Section title="Avisos do grupo">{resource.loading?<Loading/>:resource.error?<Notice error>{resource.error}</Notice>:!unread.length?<Txt muted>Nenhum aviso pendente.</Txt>:unread.slice(0,12).map(n=><View key={n.id} style={{gap:8,paddingVertical:8}}><Txt style={{fontWeight:'600'}}>{n.title}</Txt><Txt>{n.message}</Txt><Txt muted>{localDate(n.createdAt)}</Txt><Button title="Marcar como lido" variant="quiet" busy={action.busy} onPress={()=>action.run(async()=>{await api('/notifications/'+n.id+'/read',{method:'PATCH'});await resource.reload();})}/></View>)}{action.error&&<Notice error>{action.error}</Notice>}<Txt muted>Estes avisos são consultados no aplicativo. Não são notificações push remotas.</Txt></Section>;
}
export function Ranking({initialInvite,onInviteHandled}:{initialInvite?:string|null;onInviteHandled?:()=>void}){
 const groups=useResource<{items:Group[]}>('/groups');
 const [group,setGroup]=useState<Group|null>(null),[create,setCreate]=useState(false),[invite,setInvite]=useState(initialInvite||''),[name,setName]=useState(''),[description,setDescription]=useState('');
 const action=useAction();
 useEffect(()=>{if(initialInvite)setInvite(initialInvite);},[initialInvite]);
 async function createGroup(){await action.run(async()=>{if(!name.trim())throw new Error('Informe o nome do grupo.');const g=await api<Group>('/groups',{method:'POST',body:{name:name.trim(),description}});setCreate(false);setName('');setDescription('');await groups.reload();setGroup(g);});}
 async function accept(){await action.run(async()=>{const code=invite.trim().split('/').filter(Boolean).pop()||'';if(!code)throw new Error('Informe um código ou link de convite.');const result=await api<Group|{group:Group}>('/invites/accept',{method:'POST',body:{code}});setInvite('');onInviteHandled?.();await groups.reload();if('group' in result)setGroup(result.group);else if('id' in result)setGroup(result);});}
 if(group)return <GroupScreen group={group} onBack={()=>{setGroup(null);void groups.reload();}}/>;
 return <Screen title="Ranking" subtitle="Desafios privados. Cada modalidade tem sua própria classificação." onRefresh={groups.reload} refreshing={groups.loading}>
  <Button title="Criar grupo privado" onPress={()=>setCreate(true)}/>
  <Section title="Entrar com convite"><Field label="Código ou link do convite" value={invite} onChangeText={setInvite} autoCapitalize="none" autoCorrect={false}/><Button title="Entrar no grupo" variant="quiet" onPress={accept} busy={action.busy}/><Txt muted>Você precisa estar autenticado. O código pode ser revogado por um administrador.</Txt></Section>
  {action.error&&<Notice error>{action.error}</Notice>}
  <Section title="Seus grupos">{groups.loading?<Loading/>:groups.error?<Notice error>{groups.error}</Notice>:!groups.data?.items.length?<Empty text="Você ainda não participa de grupos. Crie um ou use um convite de amigos."/>:groups.data.items.map(g=><View key={g.id} style={{gap:8,paddingVertical:8}}><Txt style={{fontWeight:'600',fontSize:19}}>{g.name}</Txt>{g.description&&<Txt muted>{g.description}</Txt>}<Button title="Abrir grupo" variant="quiet" onPress={()=>setGroup(g)}/></View>)}</Section>
  <Notifications/>
  <Sheet visible={create} title="Criar grupo privado" onClose={()=>setCreate(false)}><Field label="Nome do grupo" value={name} onChangeText={setName}/><Field label="Descrição (opcional)" value={description} onChangeText={setDescription} multiline/>{action.error&&<Notice error>{action.error}</Notice>}<Button title="Criar grupo" onPress={createGroup} busy={action.busy}/></Sheet>
 </Screen>;
}
function GroupScreen({group:g,onBack}:{group:Group;onBack:()=>void}){
 const detail=useResource<Group>('/groups/'+g.id),challenges=useResource<{items:Challenge[]}>('/groups/'+g.id+'/challenges');
 const [challenge,setChallenge]=useState<Challenge|null>(null),[form,setForm]=useState<{existing?:Challenge;duplicate?:boolean}|null>(null),[admin,setAdmin]=useState(false);
 const group=detail.data||g,role=group.role||group.myRole,canAdmin=['owner','admin'].includes(role||'');
 if(form)return <ChallengeForm groupId={group.id} existing={form.existing} duplicate={form.duplicate} onBack={()=>setForm(null)} onSaved={c=>{setForm(null);setChallenge(c);void challenges.reload();}}/>;
 if(admin)return <GroupAdmin group={group} onBack={()=>setAdmin(false)}/>;
 if(challenge)return <ChallengeScreen challenge={challenge} canAdmin={canAdmin} onBack={()=>{setChallenge(null);void challenges.reload();}} onEdit={()=>setForm({existing:challenge})} onDuplicate={()=>setForm({existing:challenge,duplicate:true})}/>;
 return <Screen title={group.name} subtitle={group.description||'Grupo privado'} onBack={onBack} onRefresh={challenges.reload} refreshing={challenges.loading}>
  {detail.error&&<Notice error>{detail.error}</Notice>}
  {canAdmin&&<><Button title="Criar desafio" onPress={()=>setForm({})}/><Button title="Administrar participantes e convites" variant="quiet" onPress={()=>setAdmin(true)}/></>}
  <Section title="Desafios">{challenges.loading?<Loading/>:challenges.error?<Notice error>{challenges.error}</Notice>:!challenges.data?.items.length?<Empty text="Nenhum desafio criado. Um administrador pode definir o primeiro calendário."/>:challenges.data.items.map(c=><View key={c.id} style={{gap:9,paddingVertical:8}}><Txt style={{fontWeight:'600'}}>{c.name}</Txt><Txt muted>{challengeTypeLabels[c.rules.type]} · {Date.now()<Date.parse(c.rules.startsAt)?'Ainda não começou':Date.now()>Date.parse(c.rules.endsAt)?'Encerrado':'Em andamento'}</Txt><Txt muted>{localDate(c.rules.startsAt)} — {localDate(c.rules.endsAt)}</Txt><Button title="Ver classificação e regulamento" variant="quiet" onPress={()=>setChallenge(c)}/></View>)}</Section>
  <GroupMembers groupId={group.id}/>
  <Notifications/>
 </Screen>;
}
function GroupMembers({groupId}:{groupId:string}){
 const resource=useResource<{items:Member[]}>('/groups/'+groupId+'/members');
 return <Section title="Participantes">{resource.loading?<Loading/>:resource.error?<Notice error>{resource.error}</Notice>:resource.data?.items.map(m=><View key={m.userId} style={{gap:3,paddingVertical:7}}><Txt>{m.displayName}</Txt><Txt muted>{m.role==='owner'?'Responsável':m.role==='admin'?'Administrador':'Participante'}</Txt></View>)}</Section>;
}
function ChallengeScreen({challenge:c,canAdmin,onBack,onEdit,onDuplicate}:{challenge:Challenge;canAdmin:boolean;onBack:()=>void;onEdit:()=>void;onDuplicate:()=>void}){
 const ranking=useResource<RankingResult>('/challenges/'+c.id+'/ranking');
 const [tab,setTab]=useState<'ranking'|'rules'|'history'>('ranking');
 useEffect(()=>{const id=setInterval(()=>{if(AppState.currentState==='active')void ranking.reload();},20000);return()=>clearInterval(id);},[c.id]);
 const rules=c.rules;
 return <Screen title={c.name} subtitle={challengeTypeLabels[rules.type]} onBack={onBack} onRefresh={ranking.reload} refreshing={ranking.loading}>
  {c.description&&<Txt>{c.description}</Txt>}<Row><Choice title="Classificação" selected={tab==='ranking'} onPress={()=>setTab('ranking')}/><Choice title="Regulamento e calendário" selected={tab==='rules'} onPress={()=>setTab('rules')}/><Choice title="Histórico" selected={tab==='history'} onPress={()=>setTab('history')}/></Row>
  {tab==='ranking'?<><Txt muted>Última atualização: {localDate(ranking.data?.updatedAt)}. Atualização automática com o aplicativo em primeiro plano.</Txt>{ranking.loading&&!ranking.data?<Loading/>:ranking.error?<Notice error>{ranking.error}</Notice>:!ranking.data?.items.length?<Empty text="Ainda não há resultados elegíveis. Nenhum participante ou ponto de demonstração é exibido."/>:ranking.data.items.map(p=><Section key={p.userId}><Row><Txt style={{fontWeight:'700',fontSize:22}}>{p.position}º</Txt><View style={{flex:1}}><Txt>{p.displayName}</Txt><Txt muted>{p.weeksMet} semanas com a meta cumprida</Txt></View><Txt style={{fontWeight:'700'}}>{p.total.toLocaleString('pt-BR',{maximumFractionDigits:2})} {ranking.data?.unit==='kilometers'?'km':ranking.data?.unit==='steps'?'passos':'pts'}</Txt></Row></Section>)}<Notice>Empates podem compartilhar a posição. Trajetos, e-mails e dados detalhados de saúde não são públicos no ranking.</Notice></>:tab==='rules'?<>
   <Section title="Período"><Txt>{localDate(rules.startsAt)} até {localDate(rules.endsAt)}</Txt><Txt>Fuso: {rules.timezone}</Txt><Txt>Dias válidos: {rules.validDays.map(d=>days[d-1]).join(', ')}</Txt><Txt>Reposição: {rules.makeupDays.length?rules.makeupDays.map(d=>days[d-1]).join(', '):'nenhuma'}</Txt><Txt>Semana começa em {days[rules.weekStartsOn-1]}</Txt><Txt muted>Reposição recupera oportunidade anterior perdida na mesma semana, sem aumentar o limite.</Txt></Section>
   <Section title="Como pontuar"><Txt>Limite diário: {rules.dailyCap} · semanal: {rules.weeklyCap}</Txt>{rules.type==='consistency'&&<Txt>Dia concluído: {rules.pointsPerDay} ponto(s). Uma sessão adaptada vale o mesmo que uma de maior dificuldade.</Txt>}<Txt>Tempo ativo mínimo: {rules.minimumActiveSeconds} segundos</Txt><Txt>Modalidades: {rules.allowedModalities.map(m=>modalityLabels[m]).join(', ')}</Txt><Txt>Fontes: {rules.acceptedSources.map(s=>sourceLabels[s]||s).join(', ')}</Txt><Txt>Janela: {rules.windowStartMinute===undefined?'todo o dia':minuteClock(rules.windowStartMinute)+' até '+minuteClock(rules.windowEndMinute||0)}</Txt><Txt>Sincronização: até {rules.syncGraceHours}h · offline sem horário validável: {rules.offlinePolicy==='review'?'revisão':'salvo sem pontuar'}</Txt><Txt>Desempate: {rules.tieBreak==='weeks_met'?'semanas com a meta cumprida; depois, posição compartilhada':'posição compartilhada'}</Txt><Notice>O servidor define o dia pelo horário validado de início, no fuso do desafio. Sessões precisam respeitar o período e a janela de elegibilidade. O relógio do celular não altera a classificação.</Notice></Section>
   {ranking.data?.maximum&&<Section title="Máximo possível no calendário"><Txt>{ranking.data.maximum.total} {ranking.data.maximum.unit==='points'?'pontos':ranking.data.maximum.unit==='kilometers'?'km':'passos'}</Txt>{ranking.data.maximum.weeks.map(w=><Txt muted key={w.weekStart}>Semana {w.weekStart}: até {w.maximum} · {w.regularDates.length} dias regulares no período</Txt>)}</Section>}
  </>:<Audit groupId={c.groupId} challengeId={c.id}/>}
  {canAdmin&&<><ReviewQueue challengeId={c.id}/><Section title="Administração"><Button title="Editar regras e revisar impacto" variant="quiet" onPress={onEdit}/><Button title="Duplicar com novas datas" variant="quiet" onPress={onDuplicate}/></Section></>}
 </Screen>;
}
function minuteClock(n:number){return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');}
function Audit({groupId,challengeId}:{groupId:string;challengeId?:string}){
 const resource=useResource<{items:{id:string;challengeId?:string;actorDisplayName:string;action:string;reason?:string;createdAt:string}[]}>('/groups/'+groupId+'/audit');
 const items=resource.data?.items.filter(a=>!challengeId||a.challengeId===challengeId)||[];
 return <Section title="Histórico de alterações">{resource.loading?<Loading/>:resource.error?<Notice error>{resource.error}</Notice>:!items.length?<Empty text="Nenhuma alteração registrada."/>:items.map(a=><View key={a.id} style={{gap:5,paddingVertical:8}}><Txt>{a.action} · {a.actorDisplayName}</Txt><Txt muted>{localDate(a.createdAt)}</Txt>{a.reason&&<Txt>{a.reason}</Txt>}</View>)}</Section>;
}
function GroupAdmin({group:g,onBack}:{group:Group;onBack:()=>void}){
 const members=useResource<{items:Member[]}>('/groups/'+g.id+'/members'),invites=useResource<{items:Invite[]}>('/groups/'+g.id+'/invites');
 const [latest,setLatest]=useState<Invite|null>(null),[daysValue,setDaysValue]=useState('7'),action=useAction();
 async function makeInvite(){await action.run(async()=>{const result=await api<Invite>('/groups/'+g.id+'/invites',{method:'POST',body:{expiresInDays:Number(daysValue)}});setLatest(result);await invites.reload();});}
 async function role(userId:string,value:string){await action.run(async()=>{await api('/groups/'+g.id+'/members/'+userId,{method:'PATCH',body:{role:value}});await members.reload();});}
 return <Screen title="Administrar grupo" subtitle={g.name} onBack={onBack}>
  <Section title="Convites revogáveis"><Field label="Validade do convite em dias (1–30)" value={daysValue} onChangeText={setDaysValue} keyboardType="number-pad"/><Button title="Gerar convite" onPress={makeInvite} busy={action.busy}/>{latest?.code&&<><Txt selectable>{latest.code}</Txt><Txt muted>Expira em {localDate(latest.expiresAt)}. O código é mostrado apenas na criação.</Txt><Button title="Compartilhar convite" variant="quiet" onPress={()=>action.run(()=>shareInvite(latest.code!))}/></>}{invites.loading?<Loading/>:invites.error?<Notice error>{invites.error}</Notice>:!invites.data?.items.length?<Empty text="Nenhum convite criado."/>:invites.data.items.map(i=><View key={i.id} style={{gap:8,paddingVertical:8}}><Txt>Expiração: {localDate(i.expiresAt)}</Txt>{i.revokedAt?<Txt muted>Revogado em {localDate(i.revokedAt)}</Txt>:<Button title="Revogar convite" variant="danger" onPress={()=>confirmAction('Revogar convite?','Novas entradas com este convite serão bloqueadas.',async()=>{await action.run(async()=>{await api('/groups/'+g.id+'/invites/'+i.id,{method:'DELETE'});await invites.reload();});})}/>}</View>)}</Section>
  <Section title="Participantes e funções">{members.loading?<Loading/>:members.error?<Notice error>{members.error}</Notice>:members.data?.items.map(m=><View key={m.userId} style={{gap:8,paddingVertical:10}}><Txt>{m.displayName} · {m.role}</Txt>{m.role!=='owner'&&<><Button title={m.role==='admin'?'Tornar participante':'Tornar administrador'} variant="quiet" onPress={()=>role(m.userId,m.role==='admin'?'member':'admin')} busy={action.busy}/><Button title="Remover do grupo" variant="danger" onPress={()=>confirmAction('Remover participante?','O acesso aos dados privados deste grupo será revogado.',async()=>{await action.run(async()=>{await api('/groups/'+g.id+'/members/'+m.userId,{method:'DELETE'});await members.reload();});},true)}/></>}</View>)}</Section>
  <Audit groupId={g.id}/>
  {action.error&&<Notice error>{action.error}</Notice>}
 </Screen>;
}

type ReviewItem={activityId:string;displayName:string;modality:string;source:string;eligibility:string;ineligibleReason?:string;recordedStartAt:string;recordedEndAt:string;activeSeconds:number;distanceMeters:number|null;steps:number|null;decision:null|'approve'|'reject'};
function ReviewQueue({challengeId}:{challengeId:string}){
 const resource=useResource<{items:ReviewItem[]}>('/challenges/'+challengeId+'/review-queue');
 const [selected,setSelected]=useState<ReviewItem|null>(null),[reason,setReason]=useState(''),[start,setStart]=useState(''),[end,setEnd]=useState(''),[distance,setDistance]=useState(''),[active,setActive]=useState('');
 const action=useAction();
 function open(item:ReviewItem){setSelected(item);setReason('');setStart('');setEnd('');setDistance('');setActive('');}
 async function review(decision:'approve'|'reject'){await action.run(async()=>{if(!selected)return;if(reason.trim().length<8)throw new Error('Explique o motivo com pelo menos 8 caracteres.');await api('/activities/'+selected.activityId+'/review',{method:'POST',body:{challengeId,decision,reason:reason.trim(),...(start?{correctedStartAt:new Date(start).toISOString()}:{}),...(end?{correctedEndAt:new Date(end).toISOString()}:{}),...(distance?{distanceMeters:Number(distance.replace(',','.'))*1000}:{}),...(active?{activeSeconds:Number(active)}:{})}});setSelected(null);await resource.reload();});}
 return <Section title="Revisão de registros"><Txt muted>Anomalias são sinais para análise, não acusações. Uma revisão vale somente para este desafio, conforme a política de registros offline.</Txt>{resource.loading?<Loading/>:resource.error?<Notice error>{resource.error}</Notice>:!resource.data?.items.length?<Empty text="Nenhum registro aguardando análise."/>:resource.data.items.map(item=><View key={item.activityId} style={{gap:8,paddingVertical:9}}><Txt>{item.displayName} · {modalityLabels[item.modality]||item.modality}</Txt><Txt muted>{sourceLabels[item.source]||item.source} · {localDate(item.recordedStartAt)}</Txt><Notice>{item.ineligibleReason||item.eligibility}{item.decision?' · decisão anterior: '+item.decision:''}</Notice><Button title="Analisar e registrar decisão" variant="quiet" onPress={()=>open(item)}/></View>)}
 <Sheet visible={!!selected} title="Revisar atividade" onClose={()=>setSelected(null)}>{selected&&<><Txt>{selected.displayName} · {modalityLabels[selected.modality]}</Txt><Txt>{localDate(selected.recordedStartAt)} até {localDate(selected.recordedEndAt)}</Txt><Txt>Tempo ativo: {selected.activeSeconds}s{selected.distanceMeters!==null?' · '+(selected.distanceMeters/1000).toFixed(2)+' km':''}</Txt><Field label="Motivo da decisão (obrigatório)" multiline value={reason} onChangeText={setReason}/><Section title="Correção opcional e auditada"><Txt muted>Preencha somente dados comprovadamente incorretos. Campos vazios preservam o registro original.</Txt><Field label="Início corrigido com fuso (opcional)" value={start} onChangeText={setStart} autoCapitalize="none" placeholder="2026-12-01T08:00:00-03:00"/><Field label="Fim corrigido com fuso (opcional)" value={end} onChangeText={setEnd} autoCapitalize="none"/><Field label="Distância corrigida em km (opcional)" value={distance} onChangeText={setDistance} keyboardType="decimal-pad"/><Field label="Tempo ativo corrigido em segundos (opcional)" value={active} onChangeText={setActive} keyboardType="number-pad"/></Section><Notice>A decisão fica no histórico de auditoria e gera aviso ao participante. A classificação será recalculada.</Notice>{action.error&&<Notice error>{action.error}</Notice>}<Button title="Aprovar conforme regulamento" onPress={()=>review('approve')} busy={action.busy}/><Button title="Manter no histórico sem pontuar" variant="danger" onPress={()=>review('reject')} busy={action.busy}/></>}</Sheet>
 </Section>;
}
