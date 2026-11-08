import React, { createContext, useContext, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';
import { api } from '../lib/api';
import Storage from 'expo-sqlite/kv-store';
import { message } from './types';

const dark = { background: '#0D0F0E', surface: '#161A17', text: '#F6F7F4', muted: '#AAB4AC', border: '#303A33', accent: '#8CBF95', onAccent: '#0B2110', error: '#FFB4AB' };
const light = { background: '#FAFCF9', surface: '#EDF2EC', text: '#101A12', muted: '#526056', border: '#CBD6CA', accent: '#326D40', onAccent: '#FFFFFF', error: '#A32623' };
type Theme = typeof dark;
const ThemeContext = createContext<{ colors: Theme; isLight: boolean; toggle: () => void }>({ colors: dark, isLight: false, toggle: () => {} });
export function ThemeProvider({children}: {children: React.ReactNode}) {
  const [isLight,setLight] = useState(false);
  useEffect(()=>{void Storage.getItem('consta.theme').then(v=>setLight(v==='light'));},[]);
  return <ThemeContext.Provider value={{ colors: isLight ? light : dark, isLight, toggle: () => setLight(x => {void Storage.setItem('consta.theme',x?'dark':'light');return !x;}) }}>{children}</ThemeContext.Provider>;
}
export const useTheme = () => useContext(ThemeContext);
export function Txt({children, muted, title, style, selectable}: {children?: React.ReactNode; muted?: boolean; title?: boolean; style?: object; selectable?:boolean}) {
  const {colors:c} = useTheme(); return <Text selectable={selectable} style={[{ color: muted ? c.muted : c.text, fontSize: title ? 26 : 16, lineHeight: title ? 34 : 24, fontWeight: title ? '700' : '400' }, style]}>{children}</Text>;
}
export function Screen({children, title, subtitle, onBack, refreshing, onRefresh}: {children: React.ReactNode; title: string; subtitle?: string; onBack?: () => void; refreshing?: boolean; onRefresh?: () => void}) {
  const {colors:c} = useTheme();
  useEffect(()=>{if(!onBack)return;const sub=BackHandler.addEventListener('hardwareBackPress',()=>{onBack();return true;});return()=>sub.remove();},[onBack]);
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 22, paddingBottom: 36, gap: 18 }} style={{ flex: 1, backgroundColor: c.background }}>
    {onBack && <Button title="‹ Voltar" variant="quiet" onPress={onBack}/>}
    <View style={{gap:6}}><Txt title>{title}</Txt>{subtitle && <Txt muted>{subtitle}</Txt>}</View>
    {onRefresh && <Button title={refreshing ? 'Atualizando…' : 'Atualizar'} variant="quiet" disabled={refreshing} onPress={onRefresh}/>}
    {children}
  </ScrollView>;
}
export function Button({title, onPress, disabled, busy, variant = 'primary', accessibilityLabel}: {title: string; onPress: () => void | Promise<unknown>; disabled?: boolean; busy?: boolean; variant?: 'primary' | 'quiet' | 'danger'; accessibilityLabel?: string}) {
  const {colors:c} = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel || title} accessibilityState={{ disabled: !!disabled || !!busy, busy: !!busy }} disabled={disabled || busy} onPress={() => { void onPress(); }} style={({pressed}) => ({ minHeight: 50, paddingVertical: 13, paddingHorizontal: 17, borderRadius: 11, justifyContent: 'center', borderWidth: variant === 'primary' ? 0 : 1, borderColor: variant === 'danger' ? c.error : c.border, backgroundColor: variant === 'primary' ? c.accent : 'transparent', opacity: disabled || busy ? .45 : pressed ? .7 : 1 })}>
    {busy ? <ActivityIndicator color={variant === 'primary' ? c.onAccent : c.text}/> : <Text style={{ fontSize: 16, lineHeight: 23, fontWeight: '600', textAlign: 'center', color: variant === 'primary' ? c.onAccent : variant === 'danger' ? c.error : c.text }}>{title}</Text>}
  </Pressable>;
}
export function Field({label,hint,...props}: TextInputProps & {label: string; hint?: string}) {
  const {colors:c} = useTheme();
  return <View style={{gap:7}}><Txt>{label}</Txt><TextInput {...props} accessibilityLabel={label} placeholderTextColor={c.muted} style={[{ color:c.text, borderColor:c.border, borderWidth:1, borderRadius:10, minHeight:50, padding:13, fontSize:16, textAlignVertical: props.multiline ? 'top' : 'center' }, props.style]}/>{hint && <Txt muted style={{fontSize:13}}>{hint}</Txt>}</View>;
}
export function Section({title,children}: {title?: string; children: React.ReactNode}) {
  const {colors:c} = useTheme(); return <View style={{gap:12, paddingTop:16, borderTopColor:c.border, borderTopWidth:1}}>{title && <Txt style={{fontWeight:'700',fontSize:19}}>{title}</Txt>}{children}</View>;
}
export function Row({children}: {children: React.ReactNode}) { return <View style={{flexDirection:'row',flexWrap:'wrap',gap:9,alignItems:'center'}}>{children}</View>; }
export function Choice({title, selected, onPress}: {title:string; selected:boolean; onPress:()=>void}) {
  const {colors:c}=useTheme(); return <Pressable accessibilityRole="checkbox" accessibilityState={{checked:selected}} onPress={onPress} style={{minHeight:48,paddingHorizontal:14,paddingVertical:12,borderWidth:1,borderColor:selected?c.accent:c.border,borderRadius:10,backgroundColor:selected?c.surface:'transparent'}}><Text style={{fontSize:15,lineHeight:22,color:selected?c.accent:c.muted,fontWeight:selected?'700':'400'}}>{title}</Text></Pressable>;
}
export function Notice({children,error}: {children:React.ReactNode;error?:boolean}) { const {colors:c}=useTheme();return <View accessibilityLiveRegion="polite" style={{borderLeftWidth:3,borderColor:error?c.error:c.accent,paddingLeft:13,paddingVertical:5}}><Txt style={{color:error?c.error:c.muted}}>{children}</Txt></View>; }
export function Loading(){return <View accessibilityLabel="Carregando" style={{padding:25}}><ActivityIndicator/></View>;}
export function Empty({text}: {text:string}) {return <Notice>{text}</Notice>;}
export function Metric({label,value}: {label:string;value:string}){return <View style={{minWidth:'43%',flexGrow:1,gap:3,paddingVertical:9}}><Txt style={{fontSize:29,lineHeight:37,fontWeight:'600'}}>{value}</Txt><Txt muted style={{fontSize:13}}>{label}</Txt></View>;}
export function Sheet({visible,onClose,title,children}: {visible:boolean;onClose:()=>void;title:string;children:React.ReactNode}) {
  const {colors:c}=useTheme();return <Modal visible={visible} animationType="none" onRequestClose={onClose} presentationStyle="fullScreen"><View style={{flex:1,backgroundColor:c.background,paddingTop:30}}><Screen title={title} onBack={onClose}>{children}</Screen></View></Modal>;
}
export function confirmAction(title:string, text:string, action:()=>void|Promise<void>, destructive = false) {
  Alert.alert(title,text,[{text:'Cancelar',style:'cancel'},{text:destructive?'Excluir':'Confirmar',style:destructive?'destructive':'default',onPress:()=>{void action();}}]);
}
export function useResource<T>(path:string|null) {
  const [data,setData]=useState<T|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null);
  const load=React.useCallback(async()=>{ if(!path){setData(null);setLoading(false);return;} setLoading(true);setError(null);try{setData(await api<T>(path));}catch(e){setError(message(e));}finally{setLoading(false);}},[path]);
  useEffect(()=>{void load();},[load]);
  return {data,loading,error,reload:load,setData};
}
export function useAction(){
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const run=async<T,>(fn:()=>Promise<T>):Promise<T|undefined>=>{setBusy(true);setError(null);try{return await fn();}catch(e){setError(message(e));return undefined;}finally{setBusy(false);}};
  return {busy,error,run,clear:()=>setError(null)};
}
export function Divider(){const {colors:c}=useTheme();return <View style={{height:1,backgroundColor:c.border}}/>;}
export const uiStyles=StyleSheet.create({gap:{gap:12},grow:{flex:1}});
