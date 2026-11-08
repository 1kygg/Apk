# Configuração e execução

## Requisitos e variáveis

Use Node.js 22, npm, PostgreSQL 16, Git, Java 17 e Android Studio/SDK (Android 36 e licenças aceitas). Instale dependências com `npm ci` quando existir lockfile; no primeiro checkout sem lockfile, `npm install`. O CI registra somente o lockfile inicial na branch de trabalho, usando GITHUB_TOKEN; esse push não dispara outro workflow.

Copie `.env.example` para `.env` na raiz. Os comandos raiz `api:dev`, `api:migrate`, `api:start`, `android` e `android:apk` carregam esse arquivo com a API nativa do Node; não executam seu conteúdo como script shell. Variáveis já definidas no ambiente têm prioridade. Não envie esse arquivo ao Git nem a terceiros.

| Variável | Uso |
| --- | --- |
| DATABASE_URL | PostgreSQL da aplicação; credenciais exclusivamente no backend |
| TEST_DATABASE_URL | Banco separado e descartável de testes; nunca produção |
| JWT_SECRET | Segredo aleatório do backend com pelo menos 32 bytes; nunca EXPO_PUBLIC |
| GOOGLE_CLIENT_IDS | IDs OAuth públicos aceitos no backend, separados por vírgulas |
| APPLE_CLIENT_IDS | Identificadores de audiência Apple aceitos, separados por vírgulas |
| PORT / HOST | API; padrões 3000 e 0.0.0.0 |
| EXPO_PUBLIC_API_URL | URL base HTTPS da API, sem /v1 |
| EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID | Client ID Web Google usado para obter ID token destinado ao backend |
| EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID | Client ID OAuth iOS e esquema reverso |
| EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY | Chave pública opcional, restrita por pacote e certificado |
| CONSTA_ALLOW_CLEARTEXT | true somente para desenvolvimento HTTP local |

Gere o segredo fora do aplicativo, por exemplo `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`. Cole somente em arquivo local privado ou gerenciador de segredos. Rotacionar JWT_SECRET invalida access tokens existentes; encerre também refresh sessions quando necessário.

## Banco e API

O arquivo `compose.yaml` fornece o PostgreSQL para desenvolvimento. Ao executar a API pelo npm, suba somente o serviço `postgres` para evitar duas instâncias tentando usar a porta 3000. Para subir a API compilada em contêiner, use `docker compose up -d --build` em vez de `npm run api:dev`. Defina as credenciais conforme esse arquivo e seu `.env`. O banco de teste precisa existir separadamente se for executar integração local.

```sh
docker compose up -d postgres
npm run api:migrate
npm run api:dev
```

Confira o mapeamento de portas do compose antes de preencher DATABASE_URL. As migrações SQL ficam em `apps/api/migrations` e são aplicadas pelo runner da API. Execute as migrações antes de iniciar uma versão nova. Faça backup antes de migrar um banco com dados. Não reutilize fixtures de teste nesse banco.

Para verificar a aplicação:

```sh
npm run typecheck
npm test
npm run api:build
```

Para integração com PostgreSQL real:

```sh
# Exporte RUN_DB_TESTS=1 e use TEST_DATABASE_URL apontando ao banco descartável.
npm run test:integration
```

A suite usa identidade injetada somente no construtor interno do servidor de teste. Não existe endpoint de login de teste na API distribuída. Os testes automatizados de identidade não substituem validação do provedor externo real.

Em hospedagem, execute migrações como etapa única de implantação; mantenha o serviço e PostgreSQL em rede privada e publique apenas a API por HTTPS. Configure backups, limite de conexões, atualizações de segurança e monitoramento sem tokens, trajetos ou payloads de saúde. Nenhuma hospedagem ou domínio é provisionado automaticamente.

## Google Sign-In real

1. Crie um projeto no Google Cloud e configure a tela de consentimento OAuth. Enquanto estiver em teste, cadastre as duas contas de teste. Não há client secret no aplicativo.
2. Crie um client OAuth de tipo **Web** para a audiência dos ID tokens. Use seu ID em EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID e GOOGLE_CLIENT_IDS no backend.
3. Crie um client **Android** para o pacote `app.consta.mobile`, usando SHA-1 do certificado que assina o APK instalado. Para o artifact interno, consulte `signing-certificate.txt`; para build local consulte seu debug keystore. Cada certificado diferente exige cadastro compatível. Em publicação, inclua o certificado de assinatura do Google Play, além do upload quando aplicável.
4. Para iOS, crie client **iOS** com bundle identifier `app.consta.mobile`, preencha EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID e regenere o projeto nativo. O plugin configura o URL scheme reverso do ID.
5. Recompile o aplicativo; essas variáveis entram no build. Configure GOOGLE_CLIENT_IDS no backend e reinicie a API. Teste entrada, cancelamento, credencial inválida, indisponibilidade de rede, retomada de sessão, renovação, logout e duas contas distintas.

O backend verifica assinatura, audiência e identidade do ID token pelo provedor. Enviar um endereço de e-mail não autentica uma pessoa. Dados de ranking não incluem e-mails. A configuração disponível é informada por `/v1/config`; não interprete uma credencial ausente como login concluído.

Referências oficiais: [configuração OAuth Android](https://developers.google.com/identity/sign-in/android/start-integrating), [verificação de identidade no backend](https://developers.google.com/identity/sign-in/android/backend-auth), [Google Cloud OAuth](https://developers.google.com/identity/protocols/oauth2).

## iOS e Apple

Use macOS com Xcode, conta Apple e bundle identifier registrado. Ative a capacidade Sign in with Apple e preencha APPLE_CLIENT_IDS no servidor. A API fornece nonce de uso único e valida o token Apple, sua audiência e nonce antes de emitir sua própria sessão. O suporte no código não significa que a conta Apple esteja configurada.

Na [diretriz 4.8 vigente](https://developer.apple.com/app-store/review/guidelines/#login-services), apps que usam login social para a conta principal precisam oferecer opção equivalente que limite os dados coletados, permita ocultar e-mail e não use interações para anúncios sem consentimento, salvo as exceções descritas pela Apple. Consta prevê Sign in with Apple no iOS; configure e teste esse caminho antes de submeter. Isso não garante aprovação pela loja.

Verifique revogação da autorização Apple, exclusão de conta no app, política de privacidade e formulários de dados no momento da publicação. Não há build iOS ou teste físico iOS comprovado por um build Android. Referência: [Sign in with Apple](https://developer.apple.com/sign-in-with-apple/).

## Android nativo e APK

`npm run android` gera e executa o development build no aparelho/emulador conectado. Não dependa do Expo Go.

```sh
npm run android:apk
adb install -r artifacts/android/consta-internal.apk
```

O script faz `expo prebuild --clean`, substituindo diretórios nativos gerados, ignorados pelo Git. Alterações nativas permanentes devem ser feitas por config/plugin antes de executar. Em seguida compila `assembleRelease`, no máximo dois workers, usando assinatura de desenvolvimento do template Expo. O script falha se o template passar a usar uma assinatura diferente; não reescreve configuração de produção.

O padrão é **arm64-v8a**. Para um emulador x86_64, gere com `ANDROID_ABIS=x86_64 npm run android:apk`. O APK é para testes internos. Certificados de desenvolvimento podem mudar entre execuções do CI; nesse caso Android não atualiza um APK anterior com assinatura diferente. Desinstalar apaga dados locais. Para testes recorrentes de OAuth use certificado de desenvolvimento estável mantido localmente, nunca commitado.

Artifacts: `consta-internal.apk`, `SHA256SUMS.txt`, `signing-certificate.txt` e `INSTALL.txt`. O workflow usa runners Ubuntu padrão em repositório público e retenção de um dia. Nenhuma chave privada é publicada. Para instalar fora do ADB, baixe o artifact no GitHub, extraia o ZIP e habilite instalação dessa origem nas configurações do Android.

Configure as variáveis de repositório opcionais CONSTA_API_URL, CONSTA_GOOGLE_WEB_CLIENT_ID, CONSTA_GOOGLE_IOS_CLIENT_ID e CONSTA_GOOGLE_MAPS_ANDROID_KEY para que um build CI aponte ao seu backend. Elas são valores públicos incorporados ao aplicativo. Nunca coloque JWT_SECRET, credenciais do banco ou client secrets nessas variáveis públicas.

## Rede e mapas

Em emulador Android, o host local costuma estar em `http://10.0.2.2:3000`; em aparelho use endereço acessível na sua rede. Para esse teste, defina CONSTA_ALLOW_CLEARTEXT=true e recompile. Distribuição usa HTTPS; não mantenha essa exceção habilitada.

A chave Maps Android deve ser restrita ao pacote e SHA-1, e apenas à API necessária. A medição GPS não precisa de internet; a base cartográfica pode depender de conexão ou cache existente. Sem chave configurada, o app deve explicar a indisponibilidade do mapa e continuar mostrando o registro de localização. Não é baixado mapa offline automaticamente.

## Passos, notificações e permissões

Passos usam `expo-sensors/Pedometer`, API nativa opcional: passos da sessão para caminhada/corrida; no iOS, consulta diária quando o sistema disponibiliza. No Android o total diário pode estar indisponível e deve aparecer como ausência de dados. O acompanhamento do pedômetro em primeiro plano não garante continuidade em segundo plano; dados incompletos não devem ser classificados como sessão completa. Não há Health Connect, HealthKit ou importação de smartwatch implementados, e não se exige relógio.

Lembretes são notificações locais, pedidas somente quando a função é ativada. Não há serviço de push remoto configurado. Agenda pessoal e calendário do desafio são independentes. Negar saúde/notificações não bloqueia os demais recursos.

GPS é iniciado pela pessoa. Android usa serviço de localização com notificação persistente durante a sessão; permissões adicionais no iOS exigem explicação/aceitação específica. Não se solicita localização permanente como condição de cadastro. Fechamento forçado pode interromper a captura. A retomada usa dados locais e não inventa percurso ausente.

## Custos e publicação

Valores e regras consultados em **08/11/2026**, sujeitos a alterações:

- Rodar PostgreSQL/API e Android SDK localmente não ativa cobrança de nuvem. Hospedagem, banco gerenciado, backups, domínio e tráfego dependem do provedor escolhido; nenhum foi contratado.
- [Google Play Console](https://support.google.com/googleplay/android-developer/answer/6112435?hl=en): taxa única de US$25 e requisitos de verificação/testes conforme o tipo de conta.
- [Apple Developer Program](https://developer.apple.com/programs/whats-included/): US$99 por ano, ou moeda local onde disponível; Mac/Xcode e assinatura são necessários para distribuição iOS.
- [Google Maps Platform](https://developers.google.com/maps/billing-and-pricing/overview): cobrança e franquias dependem do SKU/uso. Habilitar faturamento, quotas ou serviço pago exige decisão do responsável; o script não o faz.
- [GitHub Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions): runners padrão são gratuitos em repositórios públicos. Artifacts e armazenamento têm regras próprias. O workflow não usa runners maiores, EAS ou serviço pago.

Antes de publicar, preencha política de privacidade, exclusão de conta, Data safety e [Health apps declaration](https://support.google.com/googleplay/android-developer/answer/14738291?hl=en). Revise as [regras de localização](https://support.google.com/googleplay/android-developer/answer/9799150?hl=en) e de foreground service; o uso enquanto a tela está apagada não dispensa a análise da política. Esses formulários e a aprovação de loja não são realizados automaticamente pelo código.
