# Execução e instalação da versão local

## Usar no celular

A versão **1.1.0**, `versionCode` 2, usa o pacote `app.consta.mobile`. Não requer conta online, credenciais OAuth, endereço de API ou banco de dados externo.

**Novo APK offline em preparação.** A release anterior `consta-android-893bed7` ainda é o aplicativo com login pendente e não deve ser confundida com o novo build local. O link verificado será registrado ao concluir a compilação.

Após instalar o APK local, abra o app e informe nome/apelido. A foto é opcional e usa o seletor do sistema. A imagem escolhida é redimensionada e copiada para o armazenamento privado do app, para continuar disponível depois de fechar o seletor. As preferências iniciais de treino são básicas e podem ser alteradas no Perfil.

## Desenvolvimento Android

Requisitos: Node.js 22, npm, Git, Java 17, Android Studio/SDK 36 e licenças aceitas. O Android mínimo é API 26 (Android 8.0), alvo/compilação API 36.

```sh
npm ci
npm run android
```

`npm run android` gera e executa um development build nativo no emulador ou aparelho conectado. Não dependa do Expo Go. A versão local não precisa de `.env`. Os wrappers de execução leem esse arquivo caso exista, mas suas antigas variáveis de servidor/OAuth não são usadas para habilitar cadastro.

Para verificar o código local:

```sh
npm run typecheck
npm test
```

`npm test` também visita os workspaces históricos. Testes do backend que precisam de PostgreSQL são condicionados à configuração explícita de integração; eles não são requisito para abrir o aplicativo local.

## APK de teste interno

```sh
npm run android:apk
adb install -r artifacts/android/consta-internal.apk
```

O script executa `expo prebuild --clean` e Gradle `assembleRelease`, com até dois workers e assinatura de desenvolvimento do template. As pastas nativas geradas são ignoradas pelo Git; mudanças permanentes devem ficar no config/plugin antes de compilar.

A arquitetura padrão é **arm64-v8a**. Para um emulador x86_64, use `ANDROID_ABIS=x86_64 npm run android:apk`. Para mais de uma ABI, informe a lista aceita pelo Gradle, por exemplo `ANDROID_ABIS=arm64-v8a,x86_64`.

O artifact contém APK, `SHA256SUMS.txt`, certificado público e `INSTALL.txt`. Chave privada não deve ser publicada. O arquivo é para testes internos, não uma publicação na Google Play. Ao instalar sem ADB, abra o APK no Android e permita a instalação dessa origem se o sistema solicitar.

Uma atualização exige pacote e assinatura compatíveis. Se a assinatura mudar, o Android pode recusar a atualização. **Desinstalar ou limpar dados remove os registros locais**; não faça isso esperando recuperação pelo Consta. Consulte o certificado/checksum que acompanhar o novo build.

## Internet, localização e permissões

Perfil, treinos, histórico e pontos são lidos e gravados no SQLite do aparelho. Não existe requisição de login ou sincronização ao backend. A pontuação usa horários do dispositivo e não deve ser tratada como resultado validado por servidor.

GPS não depende de conexão de internet para medir posições quando o aparelho dispõe de sinal de localização. Permissão, serviços de localização, ambiente e qualidade de recepção continuam necessários. O app desenha o traçado relativo dos pontos em SVG; não consulta provedor de mapa de ruas nem exige chave Google Maps. Pausas e lacunas ficam em segmentos separados.

O registro é iniciado pela pessoa. Android usa serviço de localização com notificação durante a sessão quando essa continuidade é ativada. No iOS há autorização própria para segundo plano. Não se pede localização permanente como condição de criação do perfil. Fechamento forçado pode interromper a captura; o app preserva o que foi salvo e não inventa o intervalo perdido.

Passos usam `expo-sensors/Pedometer` de forma opcional na caminhada/corrida. O total diário pode estar indisponível no Android. Contagem parcial não vira total completo da sessão. Não há Health Connect, HealthKit ou importação de smartwatch.

Lembretes são notificações locais, solicitadas ao ativar a função, e podem respeitar horários de silêncio. Negar notificações, atividade física ou foto não impede as demais funções. O compartilhamento pelo sistema é opcional; o aplicativo de destino pode usar internet.

## iOS

A base é React Native/TypeScript com suporte iOS. Use Mac/Xcode e o ambiente de assinatura correspondente para compilar e testar. O novo aplicativo local não oferece Google/Apple Sign-In e não precisa configurar esses provedores. Build Android não comprova localização em segundo plano, movimento, notificações ou VoiceOver no iOS.

## Backend histórico

`apps/api`, migrações PostgreSQL e regras de grupos/servidor permanecem como código independente. A versão local não os usa. Configurá-los não ativa automaticamente ranking online ou login no aplicativo local; isso exigiria outra integração e build.

A referência anterior está em [SETUP_ONLINE_LEGACY.md](SETUP_ONLINE_LEGACY.md) e no README de `apps/api`. Os testes de integração desse backend usam identidade de teste injetada apenas na factory e banco descartável. Nunca aponte fixtures destrutivas para um banco pessoal ou de produção.

## Custos e distribuição

Uso local não contrata hospedagem, banco gerenciado, mapas ou provedor de login. Nenhum serviço pago foi ativado. Desenvolvimento com ferramentas locais e instalação direta de APK não equivalem à publicação em loja.

Referências consultadas na entrega anterior em 08/11/2026, sujeitas a alteração:

- [Google Play Console](https://support.google.com/googleplay/android-developer/answer/6112435?hl=en): taxa única de US$25, além dos requisitos de conta/testes aplicáveis.
- [Apple Developer Program](https://developer.apple.com/programs/whats-included/): US$99 por ano ou preço local; Mac/Xcode e assinatura são necessários para distribuição iOS.
- [GitHub Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions): runners padrão em repositórios públicos são gratuitos sob as regras do serviço; o workflow não habilita runners maiores ou EAS pago.

Antes de distribuir em loja, revise formulários de privacidade, Data safety/Health apps declaration, localização e foreground service. Aprovação de loja não é comprovada por testes ou compilação.
