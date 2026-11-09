import React, {useEffect, useRef, useState} from 'react';
import {Alert, AppState, BackHandler, Share, View} from 'react-native';
import {useAccountApi} from './accountApi';
import {getTracker, subscribeTracker, startCardio, pauseCardio, resumeCardio, finishCardio, saveCardio, discardCardio, syncPendingActivities, listLocalActivities, getActivityRoute, deleteLocalActivity, saveManualActivity} from '../lib/tracking';
import {shareActivity} from '../lib/device';
import {getDailySteps} from '../lib/steps';
import type {RoutePoint} from '../lib/types';
import {Button, Choice, Empty, Field, Loading, Metric, Notice, Row, Screen, Section, Sheet, Txt, confirmAction, useAction, useResource} from './components';
import {Activity, formatTime, localDate, modalityLabels, sourceLabels} from './types';
import {RoutePreview} from './RoutePreview';

const savedLabels: Record<string, string> = {
  device_only: 'Registrando neste aparelho', pending: 'Salvo no aparelho; atualizando histórico',
  local_saved: 'Salvo neste aparelho', server_confirmed: 'Salvo neste aparelho',
  confirmed: 'Salvo neste aparelho', ineligible: 'Salvo no aparelho; consulte as observações',
};
const signalLabels: Record<string, string> = {searching: 'Buscando sinal', good: 'Sinal bom', weak: 'Sinal fraco', lost: 'Sinal perdido', permission_denied: 'Localização não autorizada'};
const unfinished = ['recording', 'paused', 'review', 'interrupted'];

export function Activities() {
  const [tracker, setTracker] = useState(getTracker);
  const [local, setLocal] = useState<Awaited<ReturnType<typeof listLocalActivities>>>([]);
  const [manual, setManual] = useState(false), [stepsEnabled, setStepsEnabled] = useState(false), [background, setBackground] = useState(false);
  const [modality, setModality] = useState<'walking'|'running'|'cycling'>('walking');
  const [notes, setNotes] = useState(''), [selected, setSelected] = useState<Activity|null>(null);
  const [daySteps, setDaySteps] = useState<Awaited<ReturnType<typeof getDailySteps>>|null>(null), [showSteps, setShowSteps] = useState(false);
  const history = useResource<{items: Activity[]}>('/activities'), action = useAction();
  const lastRead = useRef(0), lastStatus = useRef('');
  const activity = tracker.activity;
  const isTracking = !!activity && unfinished.includes(activity.status);

  async function refresh() {setLocal(await listLocalActivities()); await history.reload();}
  useEffect(() => {
    const unsubscribe = subscribeTracker(state => {
      setTracker(state);
      const status = (state.activity?.status || '')+':'+(state.activity?.syncStatus || '');
      if (status !== lastStatus.current || Date.now()-lastRead.current > 10000) {
        lastStatus.current = status; lastRead.current = Date.now();
        void listLocalActivities().then(setLocal).catch(() => {});
      }
    });
    void refresh();
    return unsubscribe;
  }, []);
  useEffect(() => {const subscription=AppState.addEventListener('change', state => {if(state==='active') void refresh();}); return () => subscription.remove();}, []);
  useEffect(() => {
    if (!isTracking) return;
    const subscription=BackHandler.addEventListener('hardwareBackPress', () => {Alert.alert('Sessão em andamento', 'Use os controles para pausar, finalizar ou descartar.'); return true;});
    return () => subscription.remove();
  }, [isTracking]);

  const pending = local.filter(a => a.status==='saved' && a.syncStatus==='pending');
  const completedHistory=history.data?.items.filter(a=>a.status==='completed')??[];
  function discard() {confirmAction('Descartar atividade?', 'O registro e o trajeto serão excluídos deste aparelho.', async () => {await action.run(async () => {await discardCardio(); await refresh();});}, true);}

  return <Screen title="Atividades" subtitle={isTracking ? 'Registro iniciado por você' : 'GPS e histórico disponíveis sem internet.'} onRefresh={refresh} refreshing={history.loading}>
    {isTracking && activity ? <>
      <Txt style={{fontSize: 21, fontWeight: '600'}}>{modalityLabels[activity.modality] || activity.modality}</Txt>
      <Notice>{signalLabels[activity.signal] || activity.signal} · {activity.status==='recording' ? 'Registrando' : activity.status==='paused' ? 'Pausada' : activity.status==='interrupted' ? 'Registro interrompido' : 'Revise antes de salvar'}</Notice>
      {activity.status==='interrupted' && <Notice error>O registro foi interrompido. O intervalo perdido não recebeu distância nem tempo ativo. Retome para criar um novo trecho ou finalize o que foi preservado.</Notice>}
      <Row>
        <Metric label="Distância por GPS" value={(activity.distanceMeters/1000).toFixed(2)+' km'}/>
        <Metric label="Tempo ativo" value={formatTime(activity.activeSeconds)}/>
        <Metric label="Tempo registrado" value={formatTime(activity.totalSeconds)}/>
        <Metric label="Tempo em pausas" value={formatTime(Math.max(0, activity.totalSeconds-activity.activeSeconds))}/>
        <Metric label={activity.modality==='cycling' ? 'Velocidade · tempo ativo' : 'Ritmo · tempo ativo'} value={activity.distanceMeters>0 && activity.activeSeconds>0 ? (activity.modality==='cycling' ? ((activity.distanceMeters/1000)/(activity.activeSeconds/3600)).toFixed(1)+' km/h' : formatTime(Math.round(activity.activeSeconds/(activity.distanceMeters/1000))).replace(/^00:/, '')+' min/km') : '—'}/>
      </Row>
      <Txt muted>O GPS usa a localização do celular, sem exigir internet. Posições imprecisas, saltos, pausas e lacunas são filtrados; sinal disponível e permissões continuam necessários.</Txt>
      <RoutePreview points={tracker.route}/>
      {activity.modality!=='cycling' && <Section title="Passos da sessão"><Txt>{activity.stepsReliable && activity.steps!==null ? activity.steps.toLocaleString('pt-BR')+' passos' : 'Sem uma contagem completa confiável nesta sessão'}</Txt><Txt muted>Origem: {activity.stepSource || 'não disponível'}. O total diário não é atribuído à atividade.</Txt></Section>}
      {activity.status==='review' ? <>
        <Field label="Observações (opcional)" value={notes} onChangeText={setNotes} multiline/>
        <Button title="Salvar atividade neste aparelho" onPress={() => action.run(async () => {await saveCardio(notes); await refresh();})} busy={action.busy}/>
        <Button title="Descartar" variant="danger" onPress={discard} busy={action.busy}/>
      </> : <>
        <Button title={activity.status==='recording' ? 'Pausar' : 'Retomar registro'} onPress={() => action.run(activity.status==='recording' ? pauseCardio : resumeCardio)} busy={action.busy}/>
        <Button title="Finalizar e revisar" variant="quiet" onPress={() => action.run(finishCardio)} busy={action.busy}/>
        <Button title="Descartar atividade" variant="danger" onPress={discard} busy={action.busy}/>
      </>}
      <Txt muted>{savedLabels[activity.syncStatus] || activity.syncStatus}. {activity.eligibilityReason || ''}</Txt>
    </> : <>
      <Section title="Cardio ao ar livre">
        <Row>{(['walking','running','cycling'] as const).map(id => <Choice key={id} title={modalityLabels[id]} selected={modality===id} onPress={() => setModality(id)}/>)}</Row>
        <Choice title="Continuar com a tela bloqueada" selected={background} onPress={() => setBackground(v => !v)}/>
        <Txt muted>O Android usa um serviço visível; o iOS pede autorização específica para continuar em segundo plano. Fechar o aplicativo à força pode interromper o registro.</Txt>
        {modality!=='cycling' && <><Choice title="Incluir passos da sessão quando disponíveis" selected={stepsEnabled} onPress={() => setStepsEnabled(v => !v)}/><Txt muted>Opcional. Negar a permissão não impede registrar o cardio.</Txt></>}
        <Button title="Iniciar registro GPS" onPress={() => action.run(async () => {setNotes(''); await startCardio(modality, {background, steps: modality!=='cycling' && stepsEnabled});})} busy={action.busy}/>
      </Section>
      <Button title="Registrar esteira, bicicleta interna ou esporte" variant="quiet" onPress={() => setManual(true)}/>
      <Section title="Passos diários opcionais">
        <Button title="Consultar passos de hoje" variant="quiet" onPress={() => action.run(async () => {setShowSteps(true); setDaySteps(await getDailySteps());})} busy={action.busy}/>
        {showSteps && daySteps && <><Txt>{daySteps.steps===null ? 'Dados indisponíveis' : daySteps.steps.toLocaleString('pt-BR')+' passos'}</Txt><Txt muted>{daySteps.source || 'Sem origem disponível'} · Última consulta: {localDate(daySteps.lastSyncedAt || undefined)}</Txt><Txt muted>{daySteps.message}</Txt><Notice>Este é o total diário. Ele não comprova treino de força e não gera pontos extras de constância.</Notice></>}
      </Section>
    </>}
    {tracker.error && <Notice error>{tracker.error}</Notice>}{action.error && <Notice error>{action.error}</Notice>}
    {!!pending.length && <Section title="Concluir gravação local"><Notice>{pending.length} registro(s) estão no aparelho, aguardando atualização do histórico. Internet não é necessária.</Notice><Button title="Atualizar histórico e pontos" variant="quiet" busy={tracker.syncing || action.busy} onPress={() => action.run(async () => {await syncPendingActivities(); await refresh();})}/></Section>}
    <Section title="Histórico neste aparelho">
      <Txt muted>Atividades e pontos pessoais ficam neste celular. Não há classificação sincronizada entre aparelhos.</Txt>
      {history.loading ? <Loading/> : history.error ? <Notice error>{history.error}</Notice> : !completedHistory.length ? <Empty text="As atividades concluídas e salvas aparecerão aqui."/> : completedHistory.map(a => <View key={a.id} style={{gap: 8, paddingVertical: 12}}>
        <Txt>{modalityLabels[a.modality] || a.modality} · {localDate(a.startedAt)}</Txt>
        <Txt muted>{sourceLabels[a.source] || a.source} · {formatTime(a.activeSeconds)}{a.distanceMeters ? ' · '+(a.distanceMeters/1000).toFixed(2)+' km' : ''}</Txt>
        <Button title="Ver atividade" variant="quiet" onPress={() => setSelected(a)}/>
      </View>)}
    </Section>
    {manual && <ManualActivity onClose={() => setManual(false)} onSaved={() => {setManual(false); void refresh();}}/>}
    {selected && <ActivityDetail activity={selected} localClientId={local.find(a => a.serverId===selected.id || a.clientId===selected.clientId)?.clientId} onClose={() => setSelected(null)} onDeleted={() => {setSelected(null); void refresh();}}/>}
  </Screen>;
}

function ManualActivity({onClose, onSaved}: {onClose: () => void; onSaved: () => void}) {
  const [modality,setModality]=useState('walking'), [duration,setDuration]=useState('20'), [distance,setDistance]=useState(''), [notes,setNotes]=useState('');
  const [environment,setEnvironment]=useState<'home'|'gym'|'outdoor'>('gym');
  const action=useAction(), hasDistance=['walking','running','cycling'].includes(modality);
  return <Sheet visible title="Registro manual" onClose={onClose}>
    <Notice>Duração e distância informadas por você, sem medição GPS. O registro fica no celular e conta para a pontuação pessoal conforme suas regras locais.</Notice>
    <Row>{Object.entries(modalityLabels).filter(([id]) => id!=='strength').map(([id,label]) => <Choice key={id} title={label} selected={modality===id} onPress={() => setModality(id)}/>)}</Row>
    <Row>{([['home','Casa'],['gym','Academia'],['outdoor','Ao ar livre']] as const).map(([id,label]) => <Choice key={id} title={label} selected={environment===id} onPress={() => setEnvironment(id)}/>)}</Row>
    <Field label="Duração em minutos" value={duration} keyboardType="decimal-pad" onChangeText={setDuration}/>
    {hasDistance && <Field label="Distância manual em quilômetros (opcional)" value={distance} keyboardType="decimal-pad" onChangeText={setDistance} hint="Use o painel da esteira ou bicicleta interna; não é distância medida por GPS."/>}
    <Field label="Observações" value={notes} onChangeText={setNotes} multiline/>
    {action.error && <Notice error>{action.error}</Notice>}
    <Button title="Salvar registro manual" busy={action.busy} onPress={() => action.run(async () => {
      const minutes=Number(duration.replace(',', '.')), km=distance ? Number(distance.replace(',', '.')) : undefined;
      if(!Number.isFinite(minutes) || minutes<=0 || minutes>720) throw new Error('Informe duração maior que zero e até 720 minutos.');
      if(km!==undefined && (!Number.isFinite(km) || km<0)) throw new Error('Informe uma distância válida ou deixe em branco.');
      await saveManualActivity({modality: modality as Parameters<typeof saveManualActivity>[0]['modality'], durationMinutes: minutes, distanceKm: hasDistance ? km : undefined, environment, notes}); onSaved();
    })}/>
  </Sheet>;
}

function ActivityDetail({activity:a, localClientId, onClose, onDeleted}: {activity:Activity; localClientId?:string; onClose:()=>void; onDeleted:()=>void}) {
  const api=useAccountApi(), action=useAction();
  const flags=a as Activity&{anomalies?:string[];warnings?:string[]};
  const [includeRoute,setIncludeRoute]=useState(false), [hideEndpoints,setHideEndpoints]=useState(true), [points,setPoints]=useState<RoutePoint[]>([]);
  useEffect(() => {let active=true; if(localClientId) void getActivityRoute(localClientId).then(route => {if(active) setPoints(route);}).catch(() => {}); return () => {active=false;};}, [localClientId]);
  return <Sheet visible title={modalityLabels[a.modality] || a.modality} onClose={onClose}>
    <Txt>{localDate(a.startedAt)} até {localDate(a.endedAt)}</Txt>
    <Txt>Origem: {sourceLabels[a.source] || a.source}</Txt>
    <Row><Metric label="Tempo ativo" value={formatTime(a.activeSeconds)}/>{a.distanceMeters!==null && a.distanceMeters!==undefined && <Metric label={a.source==='gps' ? 'Distância por GPS' : 'Distância registrada'} value={(a.distanceMeters/1000).toFixed(2)+' km'}/>}</Row>
    <Notice>Salva neste aparelho. Horários registrados pelo celular e conclusão autodeclarada, sem verificação de identidade ou atividade física.</Notice>
    {(a.ineligibleReason || a.eligibilityReason) && <Txt muted>{a.ineligibleReason || a.eligibilityReason}</Txt>}
    {!!flags.anomalies?.length&&<Notice>O aparelho marcou uma anomalia de localização. Confira o registro; esse aviso não comprova atividade física nem fraude.</Notice>}
    {!!flags.warnings?.length&&!flags.anomalies?.length&&<Notice>O registro contém métricas que merecem conferência antes de usar a distância como referência.</Notice>}
    {a.notes && <Txt>{a.notes}</Txt>}
    {!!points.length && <RoutePreview points={points}/>}
    <Section title="Compartilhamento opcional">
      <Txt muted>O percurso fica no aparelho. Compartilhar um resumo ou arquivo não sincroniza rankings entre celulares.</Txt>
      {a.source==='gps' && localClientId && <><Choice title="Incluir percurso no compartilhamento" selected={includeRoute} onPress={() => setIncludeRoute(v => !v)}/>{includeRoute && <><Choice title="Ocultar 200 m do início e do fim" selected={hideEndpoints} onPress={() => setHideEndpoints(v => !v)}/><Notice>Ocultar as extremidades reduz a exposição, mas não garante anonimato.</Notice></>}</>}
      <Button title="Compartilhar atividade" variant="quiet" busy={action.busy} onPress={() => action.run(async () => {
        if(localClientId) await shareActivity(localClientId, {includeRoute, hideEndpointsMeters: hideEndpoints ? 200 : 0});
        else await Share.share({message: (modalityLabels[a.modality] || a.modality)+' · '+formatTime(a.activeSeconds)+(a.distanceMeters ? ' · '+(a.distanceMeters/1000).toFixed(2)+' km' : '')+' · Origem: '+(sourceLabels[a.source] || a.source)});
      })}/>
    </Section>
    {action.error && <Notice error>{action.error}</Notice>}
    <Button title="Excluir atividade e atualizar pontos locais" variant="danger" busy={action.busy} onPress={() => confirmAction('Excluir atividade?', 'O registro e o trajeto serão removidos deste aparelho, e sua pontuação será atualizada. Esta ação não pode ser desfeita.', async () => {await action.run(async () => {if(localClientId) await deleteLocalActivity(localClientId); else await api('/activities/'+a.id, {method:'DELETE'}); onDeleted();});}, true)}/>
  </Sheet>;
}
