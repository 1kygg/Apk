# Consta

Aplicativo **nativo** de treinos em português do Brasil, com perfil básico e pontuação pessoal salva no celular. A versão local 1.1.0 funciona **sem login, servidor ou internet** para criar o perfil, consultar treinos, registrar atividades e acompanhar pontos.

## Android

**[Baixar Consta Offline 1.1.0](https://github.com/1kygg/Apk/releases/download/consta-offline-v1.1.0-746bd0d/consta-offline.apk)** · [assinatura e checksum](https://github.com/1kygg/Apk/releases/tag/consta-offline-v1.1.0-746bd0d).

[177 testes e build Android aprovados](https://github.com/1kygg/Apk/actions/runs/42604239761). O [teste de interface no Android 35 em modo avião](https://github.com/1kygg/Apk/actions/runs/42608028196) criou perfil pela tela, registrou um esporte manual, mostrou 1 ponto e preservou perfil/ponto após encerrar e reabrir o processo. O teste não selecionou foto nem mediu GPS, sensores, tela bloqueada, FPS ou bateria.

Esta é a versão local nova. A release anterior `consta-android-893bed7` ainda pede configuração de login e não contém esta mudança.

O alvo é Android 8.0 ou superior, arm64. A base React Native/TypeScript também é compatível com iOS, cujo build requer macOS/Xcode. Não há site ou PWA substituindo o aplicativo.

## Como usar

1. Abra o app, informe seu nome ou apelido e escolha uma foto, se desejar.
2. Toque em **Criar perfil neste aparelho**. Não há e-mail, senha ou conta Google.
3. O app oferece opções iniciais de treino para iniciante, em casa e sem equipamento. Ajuste objetivo, rotina, tempo e preferências no **Perfil**.
4. Conclua um treino ou salve uma atividade para registrar sua constância. A aba **Ranking** mostra seus próprios pontos e histórico neste aparelho.

Uma conclusão em um dia válido vale 1 ponto, até 5 por semana nas opções iniciais. As regras pessoais podem ser ajustadas e o recálculo fica explícito. Treinos adaptados têm o mesmo valor; quilômetros, passos e dificuldade não dão pontos extras de constância.

## O que funciona sem internet

- Perfil, foto local, biblioteca e sugestões diárias persistidas.
- Execução de treinos, séries, descanso, adaptações e observações.
- Registro GPS quando houver permissão, localização ativada e sinal do aparelho.
- Traçado relativo dos pontos GPS em SVG, sem mapa de ruas ou download de mapas.
- Histórico, pontuação pessoal, registros manuais e lembretes locais autorizados pelo sistema.

**Não há ranking sincronizado entre celulares nem grupos online nesta versão.** O compartilhamento pelo menu do sistema é opcional; o aplicativo escolhido para receber um arquivo ou mensagem pode precisar de internet. Os horários e a pontuação usam o aparelho, sem validação por servidor.

## Executar e compilar

Requisitos: Node.js 22, npm; para Android, Java 17 e Android SDK 36 com licenças aceitas. Não é necessário configurar `.env`, PostgreSQL ou OAuth para o aplicativo local.

```sh
npm ci
npm run android
```

Use development build nativo, pois Expo Go não contém todos os módulos. Para verificar e gerar o APK de teste:

```sh
npm run typecheck
npm test
npm run android:apk
```

Saída: `artifacts/android/consta-internal.apk`, checksum SHA256, certificado público e instruções. A assinatura é de desenvolvimento, para teste interno, sem publicação automática em loja. O projeto nativo gerado não deve receber mudanças permanentes fora dos config plugins.

Veja [execução e instalação](docs/SETUP.md), [regras locais](docs/RULES.md), [privacidade](docs/PRIVACY.md) e [matriz de verificação](docs/TEST_MATRIX.md).

## Organização e limites da entrega

- `apps/mobile`: perfil local, SQLite, cinco abas, pontuação pessoal, localização, pedômetro opcional e notificações locais.
- `packages/training`: biblioteca original, seleção diária com critérios, substituições e recuperação.
- `packages/domain`: cálculo de calendário e filtro GPS; também preserva regras da antiga arquitetura online.
- `apps/api`: backend anterior, mantido como referência independente. Ele não é executado nem acessado pelo aplicativo local. Seus testes PostgreSQL são opcionais para quem trabalha nesse módulo.

A biblioteca não é avaliação médica. Conclusão de exercícios de força é autodeclarada; sensores não comprovam sua execução. Passos usam pedômetro nativo opcional; não há importação Health Connect/HealthKit ou relógio.

Testes automatizados de SQL usam SQLite real do Node através de adaptador, sem comprovar o Expo SQLite em aparelho. Sensores, permissões reais, tela bloqueada, iOS, acessibilidade física, FPS e bateria continuam exigindo verificação específica. Não há garantia universal de 60 FPS ou registro após fechamento forçado.

Não há custo de hospedagem ou serviço obrigatório para uso local. Nenhum serviço pago foi ativado. Publicação nas lojas é opcional e tem [requisitos e custos próprios](docs/SETUP.md#custos-e-distribuição).
