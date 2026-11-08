# Privacidade e permissões

Este documento descreve o comportamento técnico e decisões de implantação. O responsável pelo serviço deve disponibilizar uma política de privacidade com identidade do controlador, contato, finalidades, retenção e procedimento de atendimento antes de publicar o app.

## Dados e acesso

A API recebe identidade validada pelo provedor e mantém apenas os dados necessários à conta, preferências, grupos, sessões, atividades e resultados. E-mails não aparecem para participantes. Toda operação de grupo exige associação/autorização no backend; conhecer um UUID não concede acesso. Convites podem ser revogados.

Access token fica na memória; refresh token usa SecureStore do sistema. O segredo de assinatura JWT e credenciais de banco ficam apenas no backend. HTTPS é obrigatório em distribuição. O banco local fica no sandbox do sistema; SQLite não deve ser descrito como SQLCipher ou criptografia adicional.

Percursos ficam no SQLite do aparelho. O backend recebe resumos para histórico e pontuação, não coordenadas da rota. Logs de aplicação não devem incluir tokens, registros de saúde, percursos ou conteúdo de solicitações. Não há anúncios ou uso de saúde para publicidade.

## Permissões por função

- Localização: solicitada ao iniciar registro de percurso. O serviço Android mostra notificação durante o registro; iOS exige consentimento específico para continuidade conforme a configuração.
- Atividade física: pedômetro opcional para caminhada/corrida. Negar não impede treino ou GPS.
- Notificações: lembretes locais opt-in, com possibilidade de desativar e horários de silêncio.
- Avatar: seletor de fotos do sistema; não exige leitura indiscriminada da galeria.
- Vibração: retorno opcional do cronômetro conforme suporte.

Câmera, microfone, contatos e fotos de comprovação não são requisitos para pontuar. Fotos de avatar são reduzidas antes do envio; não envie imagens sem direito de uso.

## Compartilhar, excluir e desconectar

O compartilhamento padrão envia resumo, sem rota. A exportação GPX é uma ação explícita; oculta por padrão áreas de 200 metros no início e fim e preserva quebras entre segmentos. Isso reduz a exposição, mas não garante anonimato: outros pontos podem revelar locais e hábitos. Depois de compartilhar um arquivo com outra pessoa, o app não controla cópias externas.

A pessoa pode excluir atividades e a própria conta. Exclusão de conta deve remover sessões, dados associados no servidor e dados locais daquela conta. O administrador do serviço deve aplicar a mesma política a backups dentro da retenção publicada; a API não elimina automaticamente cópias de backup externas.

Desconectar passos interrompe a coleta opcional. Para revogar permissões, use Perfil e configurações do sistema: Android > Apps > Consta > Permissões/Notificações; iOS > Ajustes > Consta e Privacidade e Segurança. Autorizações Google/Apple também podem ser revogadas na conta do provedor. Logout da aplicação encerra sua sessão; não equivale a apagar a conta Google ou Apple.

## Minimização e operação

Não exponha PostgreSQL à internet nem habilite logs de corpo de requisição no proxy. Restrinja chave Maps por pacote/certificado, configure backups privados e defina retenção antes do uso por um grupo real. A versão fornecida não contrata hospedagem, coleta analytics de terceiros ou transfere dados de saúde a anunciantes.

Quando não houver dado de passos confiável, mostre indisponibilidade; zero somente quando medido. Android não fornece total diário pelo pedômetro usado nesta versão. Passos da sessão com perda de acompanhamento em segundo plano ficam incompletos; nunca se atribui a ela o total diário.
