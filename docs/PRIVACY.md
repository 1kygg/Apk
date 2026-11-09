# Privacidade e permissões da versão local

Este documento descreve o comportamento técnico do Consta 1.1.0. A distribuição em loja ainda exige política de privacidade com identificação e contato do responsável, finalidades e procedimento de atendimento.

## Perfil e dados no aparelho

O perfil é um **nome ou apelido local**, com foto opcional. Não há senha, login Google/Apple, token de acesso ou verificação da identidade. O app não envia o perfil para autenticação e não oferece recuperação de conta pela nuvem.

Preferências, treinos, progresso, observações, resumos de atividades e pontos ficam no SQLite privado do app. A foto escolhida é reduzida e copiada para o diretório de documentos do aplicativo, sem upload. Percursos GPS também ficam neste aparelho. O desenho do trajeto é uma projeção dos pontos capturados, sem consulta a um mapa de ruas externo.

Os dados locais ficam no sandbox do sistema. Esta implementação não adiciona SQLCipher ou criptografia própria ao banco e não deve anunciá-las. No Android, o backup do aplicativo está desativado por `allowBackup=false`. Backups e restauração do sistema, especialmente no iOS, dependem das configurações e políticas do aparelho; o Consta não oferece backup ou sincronização próprios.

**Desinstalar o app, limpar seus dados ou perder o aparelho pode causar perda dos registros.** O perfil local não permite recuperar automaticamente pontos em outro celular. Não há ranking sincronizado entre amigos nesta versão.

## Permissões por função

- **Localização:** solicitada ao iniciar cardio GPS. A continuidade no Android usa serviço com notificação; no iOS depende da autorização correspondente. Criar perfil não exige localização.
- **Atividade física:** acesso opcional ao pedômetro para caminhada/corrida. Negar não impede treinos ou registros manuais.
- **Notificações:** lembretes locais, ativados pela pessoa, com possibilidade de desativar e escolher horários de silêncio.
- **Foto:** seletor de fotos do sistema, sem requisito de câmera ou leitura indiscriminada da galeria. A escolha é opcional.
- **Vibração:** retorno opcional do cronômetro, conforme o aparelho.

Câmera, microfone, contatos e fotos de comprovação não são requisitos para pontuar. Os controles de permissão do sistema continuam prevalecendo sobre as opções do app.

## Compartilhar por escolha

O compartilhamento padrão envia um resumo, sem percurso. Exportar GPX é uma escolha explícita: por padrão, são ocultadas áreas de 200 metros no início e no fim, e lacunas/pausas não são conectadas. Isso reduz exposição, sem garantir anonimato; os demais pontos podem revelar locais e hábitos.

O arquivo compartilhado pode conter localização sensível. O app não controla cópias que forem enviadas a outras pessoas ou aplicativos. O menu de compartilhamento pertence ao sistema; o aplicativo de destino pode precisar de internet. Não há publicação automática de trajetos, fotos ou resultados.

## Excluir e revogar

Excluir uma atividade remove o registro local e seu trajeto associado e recalcula os pontos pessoais. Apagar o perfil remove nome, foto armazenada pelo app, preferências, treinos, atividades, percursos, pontos e lembretes daquele perfil. Isso não apaga a imagem original da galeria nem cópias externas compartilhadas.

Permissões podem ser revogadas pelo sistema: Android > Apps > Consta > Permissões/Notificações; no iOS, Ajustes > Consta e Privacidade e Segurança. Para deixar de contar passos, desative essa opção antes da sessão e revogue a permissão correspondente, se desejar. Não existe integração de saúde online para desconectar.

## Limites e minimização

Os horários e a pontuação são calculados no aparelho. Eles não são resultados verificados por servidor nem comprovação física dos exercícios. Alterar relógio/fuso pode modificar o resultado local.

Não há anúncios, envio de saúde a anunciantes ou serviço de sincronização contratado. Logs do app não devem conter perfis, fotos, observações ou coordenadas. Diagnósticos e traces usados em testes precisam ser revisados antes de compartilhar.

Passos indisponíveis não significam zero confirmado. Android não fornece total diário pelo adaptador de pedômetro desta versão. Uma contagem parcial da sessão não vira total completo, e o total diário não é atribuído automaticamente a uma sessão. Health Connect, HealthKit e importação de relógios não estão implementados.

O backend anterior em `apps/api` tem regras e dependências próprias, mas não é acessado pelo app local. A presença desse código no repositório não significa transmissão ou armazenamento remoto nesta versão.
