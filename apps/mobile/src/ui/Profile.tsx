import React, {useEffect, useState} from 'react';
import {Image} from 'react-native';
import {deleteAccount} from '../lib/auth';
import {openPrivacySettings, pickAvatar} from '../lib/device';
import {cancelReminders, scheduleReminders} from '../lib/notifications';
import {useAccountApi} from './accountApi';
import {Button, Choice, Field, Loading, Notice, Row, Screen, Section, Sheet, Txt, confirmAction, useAction, useResource, useTheme} from './components';
import {PreferencesForm} from './Preferences';
import {days, type Preferences} from './types';

type LocalProfile = {id: string; displayName: string; avatarUrl?: string | null};
type Reminder = {enabled: boolean; days: number[]; hour: number; minute: number; quietStartMinute: number; quietEndMinute: number};
function toClock(minutes: number): string {
  return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
}
function toMinute(value: string): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('Use um horário no formato HH:mm, por exemplo 08:30.');
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}
export function Profile({onPreferencesChanged}: {onPreferencesChanged: () => void}) {
  const api = useAccountApi();
  const profile = useResource<LocalProfile>('/me');
  const preferences = useResource<Preferences>('/me/preferences');
  const reminders = useResource<Reminder>('/me/notifications');
  const [editPreferences, setEditPreferences] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderDays, setReminderDays] = useState<number[]>([]);
  const [time, setTime] = useState('08:00');
  const [quietStart, setQuietStart] = useState('22:00');
  const [quietEnd, setQuietEnd] = useState('07:00');
  const [privacy, setPrivacy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const action = useAction();
  const theme = useTheme();
  useEffect(() => { if (profile.data) setDisplayName(profile.data.displayName); }, [profile.data?.displayName]);
  useEffect(() => {
    if (!reminders.data) return;
    const value = reminders.data;
    setReminderEnabled(value.enabled); setReminderDays(value.days);
    setTime(toClock(value.hour * 60 + value.minute));
    setQuietStart(toClock(value.quietStartMinute)); setQuietEnd(toClock(value.quietEndMinute));
  }, [reminders.data]);
  async function saveName() {
    await action.run(async () => {
      const name = displayName.trim();
      if (!name || name.length > 80) throw new Error('Use um nome entre 1 e 80 caracteres.');
      await api('/me', {method: 'PATCH', body: {displayName: name}});
      await profile.reload(); setFeedback('Seu nome foi salvo neste aparelho.');
    });
  }
  async function avatar() {
    await action.run(async () => {
      const uri = await pickAvatar(); if (!uri) return;
      await profile.reload(); setFeedback('Sua foto foi salva neste aparelho.');
    });
  }
  async function saveReminders() {
    await action.run(async () => {
      const minute = toMinute(time), start = toMinute(quietStart), end = toMinute(quietEnd);
      if (reminderEnabled && !reminderDays.length) throw new Error('Escolha ao menos um dia para os lembretes.');
      if (reminderEnabled) await scheduleReminders({enabled: true, days: reminderDays, hour: Math.floor(minute / 60), minute: minute % 60, quietStart, quietEnd});
      else await cancelReminders();
      await api('/me/notifications', {method: 'PATCH', body: {enabled: reminderEnabled, days: reminderDays, hour: Math.floor(minute / 60), minute: minute % 60, quietStartMinute: start, quietEndMinute: end}});
      setFeedback(reminderEnabled ? 'Lembretes locais salvos. Eles funcionam sem internet.' : 'Lembretes desativados neste aparelho.');
    });
  }
  function removeProfile() {
    confirmAction('Apagar perfil e dados deste aparelho?', 'Seu nome, foto do perfil, pontos, treinos, atividades, trajetos e lembretes locais serão apagados. Não há recuperação pelo Consta depois de confirmar.', async () => { await action.run(deleteAccount); }, true);
  }
  if (editPreferences && preferences.data) return <PreferencesForm initial={preferences.data} onBack={() => setEditPreferences(false)} onSaved={() => {setEditPreferences(false); void preferences.reload(); onPreferencesChanged();}}/>;
  return <Screen title="Perfil local" subtitle="Seu nome, sua foto e seu ritmo neste aparelho." onRefresh={async () => {await Promise.all([profile.reload(), preferences.reload(), reminders.reload()]);}} refreshing={profile.loading}>
    <Notice>Sem login e sem servidor. Seus registros e pontos ficam neste celular.</Notice>
    {profile.loading ? <Loading/> : profile.error ? <Notice error>{profile.error}</Notice> : <>
      {profile.data?.avatarUrl && <Image accessible source={{uri: profile.data.avatarUrl}} accessibilityLabel="Sua foto de perfil" style={{width: 88, height: 88, borderRadius: 44}}/>}
      <Field label="Nome de exibição" value={displayName} onChangeText={setDisplayName} maxLength={80}/>
      <Button title="Salvar nome" variant="quiet" onPress={saveName} busy={action.busy}/>
      <Button title="Escolher foto de perfil" variant="quiet" onPress={avatar} busy={action.busy}/>
    </>}
    <Section title="Treinos e rotina pessoal">
      {preferences.error && <Notice error>{preferences.error}</Notice>}
      <Button title="Atualizar preferências e exercícios evitados" variant="quiet" disabled={!preferences.data} onPress={() => setEditPreferences(true)}/>
      <Txt muted>Suas preferências organizam as sugestões de treino. Lembretes são pessoais; alterar um horário de aviso não gera pontos.</Txt>
    </Section>
    <Section title="Lembretes deste aparelho">
      {reminders.loading ? <Loading/> : reminders.error ? <Notice error>{reminders.error}</Notice> : null}
      <Choice title="Ativar lembretes" selected={reminderEnabled} onPress={() => setReminderEnabled(value => !value)}/>
      <Row>{days.map((day, index) => <Choice key={day} title={day} selected={reminderDays.includes(index + 1)} onPress={() => setReminderDays(values => values.includes(index + 1) ? values.filter(value => value !== index + 1) : [...values, index + 1])}/>)}</Row>
      <Field label="Horário preferido (HH:mm)" value={time} onChangeText={setTime} keyboardType="numbers-and-punctuation"/>
      <Field label="Início do silêncio (HH:mm)" value={quietStart} onChangeText={setQuietStart} keyboardType="numbers-and-punctuation"/>
      <Field label="Fim do silêncio (HH:mm)" value={quietEnd} onChangeText={setQuietEnd} keyboardType="numbers-and-punctuation"/>
      <Button title="Salvar lembretes" variant="quiet" onPress={saveReminders} busy={action.busy}/>
      <Txt muted>A permissão de notificações é solicitada somente ao ativar. Você pode continuar usando o app sem permitir os avisos.</Txt>
    </Section>
    <Section title="Aparência">
      <Choice title="Tema claro" selected={theme.isLight} onPress={theme.toggle}/>
      <Txt muted>O texto acompanha o tamanho de fonte do sistema. As transições são discretas.</Txt>
    </Section>
    <Section title="Internet e permissões">
      <Txt>Perfil, treinos, histórico e pontuação pessoal funcionam sem internet. O GPS pode registrar distância quando houver sinal de localização.</Txt>
      <Txt muted>O mapa pode depender de conexão ou cache. Sem servidor, não há ranking sincronizado entre celulares.</Txt>
      <Txt muted>Passos são opcionais e a disponibilidade aparece na tela Atividades. Não é necessário ter smartwatch.</Txt>
      <Button title="Gerenciar permissões no aparelho" variant="quiet" onPress={() => action.run(openPrivacySettings)}/>
      <Button title="Consultar privacidade" variant="quiet" onPress={() => setPrivacy(true)}/>
    </Section>
    {feedback && <Notice>{feedback}</Notice>}{action.error && <Notice error>{action.error}</Notice>}
    <Button title="Apagar perfil e dados deste aparelho" variant="danger" onPress={removeProfile} busy={action.busy}/>
    <Sheet title="Privacidade neste aparelho" visible={privacy} onClose={() => setPrivacy(false)}>
      <Section title="Armazenamento local">
        <Txt>Esta versão não tem conta online nem servidor de sincronização. Perfil, pontos, observações e histórico são guardados neste celular.</Txt>
        <Txt>Não há backup ou recuperação de dados pelo Consta. Apagar os dados do aplicativo ou desinstalá-lo pode remover seus registros. Backups do sistema dependem das configurações do aparelho.</Txt>
      </Section>
      <Section title="Você controla as permissões">
        <Txt>Localização é usada no registro de percurso iniciado por você. Passos, notificações e a foto de perfil são opcionais.</Txt>
        <Txt>A foto é escolhida pelo seletor do sistema. Câmera, microfone, contatos ou fotos de comprovação não são exigidos para pontuar.</Txt>
        <Button title="Abrir configurações de permissões" variant="quiet" onPress={() => action.run(openPrivacySettings)}/>
      </Section>
      <Section title="Trajetos e compartilhamento">
        <Txt>O mapa, quando disponível, pode consultar um provedor pela internet. O registro GPS pode continuar sem internet, mas depende do sinal e das permissões do aparelho.</Txt>
        <Txt>Compartilhar um resumo ou arquivo de percurso é uma escolha sua. Ocultar início e fim reduz exposição, sem garantir anonimato.</Txt>
        <Txt>Fechar o aplicativo à força pode interromper o registro. O período perdido não recebe posições inventadas.</Txt>
      </Section>
      <Section title="Pontuação pessoal">
        <Txt>Os pontos são calculados neste aparelho com as datas registradas nele. Conclusões de treinos são autodeclaradas; GPS e cronômetros não comprovam fisicamente exercícios.</Txt>
        <Txt>Você pode excluir atividades no histórico. A pontuação local é recalculada com os registros restantes.</Txt>
      </Section>
    </Sheet>
  </Screen>;
}
