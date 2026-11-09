import React, {useEffect, useMemo, useState} from 'react';
import {AppState, Image, View} from 'react-native';
import {DateTime} from 'luxon';
import {captureAccountScope, assertAccountScope} from '../lib/account-scope';
import {getLocalPreference, setLocalPreference} from '../lib/storage';
import {
  calculateLocalProgress, DEFAULT_LOCAL_SCORING_RULES, validateLocalScoringRules,
  type LocalScoreActivity, type LocalScoringRules,
} from '../lib/local-score';
import {Button, Choice, Empty, Field, Loading, Metric, Notice, Row, Screen, Section, Sheet, Txt, useAction, useResource} from './components';
import {days, message} from './types';

type Me = {id: string; displayName: string; avatarUrl?: string | null};

/** This screen only compares this profile with its own local history. */
export function Ranking() {
  const profile = useResource<Me>('/me');
  const preferences = useResource<{timezone: string}>('/me/preferences');
  const activities = useResource<{items: LocalScoreActivity[]}>('/activities');
  const [scope] = useState(() => captureAccountScope());
  const [rules, setRules] = useState<LocalScoringRules>(DEFAULT_LOCAL_SCORING_RULES);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [weeklyLimit, setWeeklyLimit] = useState('5');
  const [weekStartsOn, setWeekStartsOn] = useState(1);
  const [validDays, setValidDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  const [asOf, setAsOf] = useState(() => new Date().toISOString());
  const action = useAction();
  const timezone = preferences.data?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  async function refresh() {
    await Promise.all([profile.reload(), preferences.reload(), activities.reload()]);
    setAsOf(new Date().toISOString());
  }

  useEffect(() => {
    let active = true;
    setRulesLoading(true);
    void getLocalPreference<LocalScoringRules>('local-score-rules.' + scope.userId).then(saved => {
      assertAccountScope(scope);
      if (active) setRules(validateLocalScoringRules(saved || DEFAULT_LOCAL_SCORING_RULES));
    }).catch(error => {
      if (active) setRulesError(message(error));
    }).finally(() => {if (active) setRulesLoading(false);});
    return () => {active = false;};
  }, [scope]);

  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {if (state === 'active') void refresh();});
    const timer = setInterval(() => {if (AppState.currentState === 'active') setAsOf(new Date().toISOString());}, 60000);
    return () => {listener.remove(); clearInterval(timer);};
  }, []);

  const result = useMemo(() => {
    try {
      return {value: calculateLocalProgress(activities.data?.items || [], timezone, {...rules, asOf, profileId: scope.userId}), error: null};
    } catch (error) {return {value: null, error: message(error)};}
  }, [activities.data, timezone, rules, asOf, scope.userId]);
  const progress = result.value;
  const loading = profile.loading || preferences.loading || activities.loading || rulesLoading;
  const error = profile.error || preferences.error || activities.error || result.error;
  const dateLabel = (date: string) => DateTime.fromISO(date, {zone: timezone}).toFormat('dd/LL/yyyy');

  function openSettings() {
    setWeeklyLimit(String(rules.weeklyCap));
    setWeekStartsOn(rules.weekStartsOn);
    setValidDays([...rules.validDays]);
    setSettings(true);
  }

  async function saveRules() {
    await action.run(async () => {
      const cap = Number(weeklyLimit);
      if (!Number.isInteger(cap) || cap < 1 || cap > 7) throw new Error('Escolha um limite semanal inteiro de 1 a 7 pontos.');
      const next = validateLocalScoringRules({dailyCap: 1, weeklyCap: cap, weekStartsOn, validDays});
      assertAccountScope(scope);
      await setLocalPreference('local-score-rules.' + scope.userId, next);
      assertAccountScope(scope);
      setRules(next); setRulesError(null); setSettings(false);
    });
  }

  return <Screen title="Sua constância" subtitle="Pontuação pessoal salva neste aparelho." onRefresh={refresh} refreshing={activities.loading}>
    <Notice>Esta pontuação funciona sem internet. Não há classificação sincronizada entre celulares nem participantes de demonstração.</Notice>
    {loading ? <Loading/> : error ? <Notice error>{error}</Notice> : progress && <>
      <View style={{gap: 12, paddingVertical: 8}}>
        {profile.data?.avatarUrl && <Image source={{uri: profile.data.avatarUrl}} accessibilityLabel="Sua foto de perfil" style={{width: 76, height: 76, borderRadius: 38}}/>}
        <Txt style={{fontSize: 24, fontWeight: '600'}}>{profile.data?.displayName}</Txt>
        <Row><Metric label="Pontos no histórico" value={String(progress.totalPoints)}/><Metric label="Pontos nesta semana" value={String(progress.currentWeek.points) + ' / ' + progress.currentWeek.limit}/></Row>
        <Txt muted>Semana de {dateLabel(progress.currentWeek.start)} a {dateLabel(progress.currentWeek.end)} · fuso {timezone}</Txt>
        <Txt muted>{progress.totalCompletedSessions} sessão(ões) concluída(s) · {progress.creditedDays} dia(s) pontuado(s)</Txt>
      </View>
      <Section title="Como os pontos são contados">
        <Txt>Uma sessão concluída em um dia válido vale 1 ponto, até {rules.weeklyCap} por semana. Várias sessões no mesmo dia continuam valendo 1 ponto.</Txt>
        <Txt>Adaptações e versões mais fáceis têm o mesmo valor. Quilômetros, passos, carga e repetições não dão pontos extras de constância.</Txt>
        <Txt muted>Dias válidos: {rules.validDays.map(day => days[day - 1]).join(', ')}. A semana começa em {days[rules.weekStartsOn - 1]}.</Txt>
        <Txt muted>A sessão pertence ao dia em que começou. Uma sessão que atravessa a meia-noite continua nesse dia.</Txt>
        <Notice>Conclusões são autodeclaradas e os horários vêm do aparelho. Alterar o relógio ou o fuso da rotina pode mudar os resultados; não há validação por servidor.</Notice>
        <Button title="Ajustar regras pessoais" variant="quiet" onPress={openSettings}/>
      </Section>
      {rulesError && <Notice error>{rulesError} As regras padrão estão sendo exibidas. Abra os ajustes para conferir e salvar.</Notice>}
      <Section title="Distâncias no histórico">
        <Txt muted>Quilômetros registrados, incluindo fontes manuais identificadas nas atividades. Cada modalidade tem seu próprio total.</Txt>
        <Row><Metric label="Caminhada" value={progress.distancesKm.walking.toLocaleString('pt-BR', {maximumFractionDigits: 2}) + ' km'}/><Metric label="Corrida" value={progress.distancesKm.running.toLocaleString('pt-BR', {maximumFractionDigits: 2}) + ' km'}/><Metric label="Ciclismo" value={progress.distancesKm.cycling.toLocaleString('pt-BR', {maximumFractionDigits: 2}) + ' km'}/></Row>
        {progress.flaggedDistanceSessions > 0 && <Notice>Há {progress.flaggedDistanceSessions} registro(s) GPS com anomalias sinalizadas. Seus quilômetros não entram nesses totais; a conclusão autodeclarada continua no histórico de constância.</Notice>}
      </Section>
      <Section title="Dias registrados">
        {!progress.days.length ? <Empty text="Ainda não há sessão concluída. Seus pontos aparecerão aqui depois de salvar uma atividade ou concluir um treino."/> : progress.days.slice(0, 90).map(day => <View key={day.date} style={{gap: 4, paddingVertical: 8}}>
          <Txt>{dateLabel(day.date)} · {day.points} ponto(s)</Txt>
          <Txt muted>{day.sessions} sessão(ões){!day.validDay ? ' · dia fora das suas regras pessoais' : day.points === 0 ? ' · limite semanal já atingido' : ''}</Txt>
        </View>)}
        {progress.days.length > 90 && <Txt muted>Mostrando os 90 dias registrados mais recentes. Os totais incluem todo o histórico salvo.</Txt>}
      </Section>
      <Txt muted>Excluir uma atividade recalcula os pontos. Descanso faz parte do planejamento; não é necessário aumentar a dificuldade para pontuar.</Txt>
      <Txt muted>Último cálculo neste aparelho: {DateTime.fromISO(progress.asOf).setZone(timezone).toFormat('dd/LL/yyyy HH:mm')}</Txt>
    </>}
    <Sheet title="Regras pessoais de constância" visible={settings} onClose={() => setSettings(false)}>
      <Notice>Estas regras pertencem ao seu perfil local. Alterar e salvar recalcula os pontos de todo o histórico neste aparelho.</Notice>
      <Txt>Valor de cada dia concluído: 1 ponto, independentemente da quantidade ou dificuldade das sessões.</Txt>
      <Field label="Limite de pontos por semana (1 a 7)" value={weeklyLimit} onChangeText={setWeeklyLimit} keyboardType="number-pad"/>
      <Section title="Dias válidos"><Row>{days.map((day, index) => <Choice key={day} title={day} selected={validDays.includes(index + 1)} onPress={() => setValidDays(current => current.includes(index + 1) ? current.filter(value => value !== index + 1) : [...current, index + 1])}/>)}</Row></Section>
      <Section title="Primeiro dia da semana"><Row>{days.map((day, index) => <Choice key={day} title={day} selected={weekStartsOn === index + 1} onPress={() => setWeekStartsOn(index + 1)}/>)}</Row></Section>
      {action.error && <Notice error>{action.error}</Notice>}
      <Button title="Salvar e recalcular pontuação local" onPress={saveRules} busy={action.busy}/>
    </Sheet>
  </Screen>;
}
