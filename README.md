# Consta

Aplicativo **nativo** de treinos e desafios privados entre amigos, em português do Brasil. Android é a plataforma prioritária; a base React Native/TypeScript também suporta iOS. Não há versão web substituindo sensores nativos.

## Código

- `apps/mobile`: Expo SDK 54, cinco abas, Google Sign-In nativo, Apple Sign-In no iOS, SQLite, SecureStore, localização, pedômetro opcional e lembretes locais.
- `apps/api`: API Fastify, validação de identidade no servidor, sessões renováveis, PostgreSQL, grupos privados, convites revogáveis, desafios, atividades, auditoria e ranking calculado no servidor.
- `packages/domain`: calendário por fuso, limites e reposições, classificação, validação de regras e filtro GPS.
- `packages/training`: biblioteca própria em texto, seleção diária com critérios, substituições e progressão moderada.

A biblioteca e as sugestões não são avaliação médica. Treinos de força são autodeclarados. Dificuldade, carga e quilômetros não criam pontos extras de constância.

## Começar

Requisitos: Node.js 22, npm, PostgreSQL 16; para Android, Java 17 e Android SDK. Para iOS, macOS/Xcode.

```sh
npm install
cp .env.example .env
# Preencha .env: banco, JWT_SECRET aleatório >=32 bytes e IDs OAuth.
npm run api:migrate
npm run api:dev
```

Em outro terminal:

```sh
npm run android
```

Use development build; Expo Go não contém todos os módulos. Veja [configuração completa](docs/SETUP.md), [regras](docs/RULES.md) e [privacidade](docs/PRIVACY.md).

## Verificar e gerar APK

```sh
npm run typecheck
npm test
npm run test:integration
npm run api:build
npm run android:apk
```

Integração usa PostgreSQL real, `RUN_DB_TESTS=1` e banco de teste descartável. Leia [a matriz de testes](docs/TEST_MATRIX.md) antes de executar: fixtures removem dados do banco de teste.

[GitHub Actions](https://github.com/1kygg/Apk/actions) executa verificações e compila APK release arm64 para **teste interno**, assinado com chave de desenvolvimento. O artifact temporário contém APK, checksum SHA256 e certificado público. Não contém chave privada. Não é assinatura de publicação na Play Store. Instalação: `adb install -r artifacts/android/consta-internal.apk`.

## Configurações externas e limites de verificação

Sem projeto OAuth configurado, login permanece indisponível com mensagem de configuração; não existe entrada simulada. Sem API implantada e URL HTTPS configurada, não há sincronização remota. Google Maps é opcional: falta da chave não deve impedir o registro GPS.

Testes automatizados e compilação devem ser confirmados pelo resultado da execução correspondente do CI. Login com duas contas reais, sensores, tela bloqueada, permissões, iOS e medições em aparelho físico precisam ser executados com as credenciais e o hardware adequados. Não há medição de 60 FPS ou autonomia registrada nesta entrega. Passos usam pedômetro nativo opcional; não há importação Health Connect/HealthKit ou relógio implementada.

Nenhum serviço pago é ativado pelos scripts. Consulte [dependências e distribuição](docs/SETUP.md#custos-e-publicação).
