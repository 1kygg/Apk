import React, {useState} from 'react';
import {View} from 'react-native';
import {useAccountApi} from './accountApi';
import {Button, Choice, Field, Loading, Notice, Row, Screen, Section, Txt, useAction, useResource} from './components';
import {days, defaultPreferences, environmentLabels, Exercise, modalityLabels, Preferences, Modality} from './types';

export function PreferencesForm({initial,onSaved,onBack,onboarding=false}:{initial?:Preferences;onSaved:(p:Preferences)=>void;onBack?:()=>void;onboarding?:boolean}){
  const api=useAccountApi();
  const [p,setP]=useState<Preferences>(initial || defaultPreferences());
  const library=useResource<{exercises:Exercise[];equipment:Record<string,string>}>('/exercises');
  const [avoidSearch,setAvoidSearch]=useState('');
  const action=useAction();
  function change<K extends keyof Preferences>(k:K,v:Preferences[K]){setP(x=>({...x,[k]:v}));}
  function toggle<T,>(array:T[],value:T):T[]{return array.includes(value)?array.filter(x=>x!==value):[...array,value];}
  async function save(){
    await action.run(async()=>{
      if(!p.availableDays.length)throw new Error('Escolha pelo menos um dia disponível.');
      if(!Number.isFinite(p.durationMinutes)||p.durationMinutes<5||p.durationMinutes>180)throw new Error('Escolha entre 5 e 180 minutos.');
      if(!p.modalities.length)throw new Error('Escolha pelo menos uma modalidade.');
      const value=await api<Preferences>('/me/preferences',{method:'PATCH',body:p});onSaved(value);
    });
  }
  return <Screen title={onboarding?'Seu ritmo, seu ponto de partida':'Preferências de treino'} subtitle="Estas escolhas organizam sugestões de atividade. Elas não são uma avaliação médica." onBack={onBack}>
    <Section title="O que você busca?"><Row>{([['health','Saúde e bem-estar'],['strength','Força'],['conditioning','Condicionamento']] as const).map(([v,t])=><Choice key={v} title={t} selected={p.goal===v} onPress={()=>change('goal',v)}/>)}</Row></Section>
    <Section title="Experiência"><Row>{([['beginner','Começando'],['intermediate','Já pratico'],['advanced','Experiente']] as const).map(([v,t])=><Choice key={v} title={t} selected={p.level===v} onPress={()=>change('level',v)}/>)}</Row></Section>
    <Section title="Disponibilidade pessoal"><Txt muted>Escolha os dias que combinam com sua rotina. Eles organizam suas sugestões de treino neste aparelho; descansar também faz parte.</Txt><Row>{days.map((d,i)=><Choice key={d} title={d} selected={p.availableDays.includes(i+1)} onPress={()=>change('availableDays',toggle(p.availableDays,i+1))}/>)}</Row><Field label="Minutos disponíveis por sessão" keyboardType="number-pad" value={String(p.durationMinutes||'')} onChangeText={v=>change('durationMinutes',Number(v))}/></Section>
    <Section title="Onde você prefere treinar?"><Row>{Object.entries(environmentLabels).map(([v,t])=><Choice key={v} title={t} selected={p.environment===v} onPress={()=>change('environment',v as Preferences['environment'])}/>)}</Row><Txt muted>Você também pode trocar de ambiente antes de iniciar o treino.</Txt></Section>
    <Section title="Equipamentos disponíveis"><Txt muted>Em casa, nenhum equipamento selecionado significa priorizar o peso do corpo.</Txt>{library.loading?<Loading/>:library.error?<Notice error>{library.error}</Notice>:<Row>{Object.entries(library.data?.equipment||{}).map(([id,label])=><Choice key={id} title={label} selected={p.equipment.includes(id)} onPress={()=>change('equipment',toggle(p.equipment,id))}/>)}</Row>}</Section>
    <Section title="Modalidades favoritas"><Row>{Object.entries(modalityLabels).map(([v,t])=><Choice key={v} title={t} selected={p.modalities.includes(v as Modality)} onPress={()=>change('modalities',toggle(p.modalities,v as Modality))}/>)}</Row></Section>
    <Section title="Exercícios que prefere evitar"><Field label="Buscar um exercício (opcional)" value={avoidSearch} onChangeText={setAvoidSearch}/>{(library.data?.exercises||[]).filter(x=>p.avoidExerciseIds.includes(x.id)||(avoidSearch.length>1&&x.name.toLocaleLowerCase().includes(avoidSearch.toLocaleLowerCase()))).slice(0,25).map(x=><Choice key={x.id} title={x.name} selected={p.avoidExerciseIds.includes(x.id)} onPress={()=>change('avoidExerciseIds',toggle(p.avoidExerciseIds,x.id))}/>)}</Section>
    <Field label="Fuso da sua rotina" value={p.timezone} onChangeText={v=>change('timezone',v)} autoCapitalize="none" hint="Ex.: America/Sao_Paulo. Usado para organizar os dias da sua rotina e da pontuação local."/>
    {action.error&&<Notice error>{action.error}</Notice>}
    <Button title={onboarding?'Salvar e começar':'Salvar preferências'} onPress={save} busy={action.busy}/>
  </Screen>;
}
