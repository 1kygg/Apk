# Arquitetura da versão local 1.1.0

O aplicativo React Native/TypeScript com Expo SDK 54 executa no celular. Não há login, tokens, chamadas HTTP da aplicação ou servidor necessário para abrir o perfil e usar treinos, histórico e pontuação.

- `auth.ts` mantém o ciclo do perfil local; o nome histórico do arquivo não indica autenticação de identidade. Nome e foto são escolhidos pela pessoa e persistidos no aparelho.
- `api.ts` é uma fachada de métodos locais sobre `local-service.ts`/SQLite. Não executa `fetch`. O serviço mantém preferências, planos, conclusões e histórico com transações e chaves idempotentes.
- `storage.ts` mantém captura GPS, segmentos e consolidações locais. Uma fila de escrita comum evita misturar transações exclusivas do serviço com gravações da captura; falhas transitórias de bloqueio têm tentativas limitadas.
- `local-score.ts` calcula a constância pessoal e quilômetros separados com horários do aparelho. Não fabrica validação por servidor nem ranking entre celulares. Uma sessão adaptada tem o mesmo valor diário.
- `packages/training` contém biblioteca e ilustrações originais, critérios de ambiente/equipamentos, recuperação e geração diária. Planos iniciados preservam a versão original e as adaptações separadas.
- `tracking.ts` usa localização/TaskManager, serviço visível Android e persistência local. Lacunas e pausas não são conectadas; retomada de processo não inventa tempo ou distância.
- `RoutePreview.tsx` desenha os pontos GPS em SVG no aparelho. Não é mapa de ruas, não baixa tiles e não depende de chave de mapas.

As APIs de pedômetro, notificações, foto, localização e compartilhamento continuam nativas. A foto é copiada para documentos privados do app. Os callbacks são vinculados ao perfil e à geração da sessão local para impedir gravações atrasadas em outro perfil. Não há verificação de identidade ou proteção absoluta contra alteração do relógio/dados do aparelho.

O backend anterior permanece em `apps/api` como módulo histórico e opcional, com suas migrações e testes. Ele não recebe dados do aplicativo local. Sua configuração está separada em `docs/SETUP_ONLINE_LEGACY.md`.

O CI verifica TypeScript e testes, compila o APK arm64 e oferece uma execução independente em emulador x86_64 para criação de perfil/ponto offline. Só resultados efetivamente concluídos são evidência. Sensores físicos, iOS e desempenho exigem testes próprios. A assinatura do APK interno é de desenvolvimento; publicação em loja exige preparação específica.
