import React, {useState} from 'react';
import {Image, View} from 'react-native';
import {createLocalProfile} from '../lib/auth';
import {pickLocalAvatar} from '../lib/device';
import {Button, Field, Notice, Screen, Section, Txt, useAction} from './components';

export function LocalWelcome() {
  const [displayName, setDisplayName] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const action = useAction();
  async function choosePhoto() {
    await action.run(async () => {
      const selected = await pickLocalAvatar();
      if (selected) setAvatarUri(selected);
    });
  }
  async function createProfile() {
    await action.run(async () => {
      const name = displayName.trim();
      if (!name || name.length > 80) throw new Error('Informe um nome entre 1 e 80 caracteres.');
      await createLocalProfile({displayName: name, avatarUri: avatarUri ?? undefined});
    });
  }
  return <Screen title="Consta" subtitle="Treinos no seu ritmo, salvos no seu celular.">
    <View style={{paddingVertical: 10, gap: 14}}>
      <Txt style={{fontSize: 34, lineHeight: 43, fontWeight: '600'}}>Seu perfil. Seu próximo passo.</Txt>
      <Txt muted>Escolha como quer aparecer e comece a acompanhar sua constância.</Txt>
    </View>
    <Section title="Como você quer ser chamado?">
      <Field label="Nome de exibição" value={displayName} onChangeText={setDisplayName} placeholder="Seu nome ou apelido" autoCapitalize="words" autoCorrect={false} maxLength={80}/>
      {avatarUri && <Image accessible source={{uri: avatarUri}} accessibilityLabel="Foto escolhida para seu perfil" style={{width: 96, height: 96, borderRadius: 48}}/>}
      <Button title={avatarUri ? 'Trocar foto de perfil' : 'Escolher foto de perfil (opcional)'} variant="quiet" onPress={choosePhoto} busy={action.busy}/>
    </Section>
    <Notice>Sem login e sem servidor. Seu perfil, seus registros e seus pontos ficam neste celular.</Notice>
    <Txt muted>Treinos, histórico e pontuação pessoal funcionam sem internet. O GPS pode registrar seu percurso quando houver sinal; o mapa pode precisar de conexão.</Txt>
    <Txt muted>O ranking entre celulares não é sincronizado. Apagar os dados do aplicativo pode remover seus registros locais.</Txt>
    {action.error && <Notice error>{action.error}</Notice>}
    <Button title="Criar perfil neste aparelho" onPress={createProfile} busy={action.busy}/>
  </Screen>;
}
