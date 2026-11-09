# @consta/training

Biblioteca e gerador determinístico usados pela API e pelo aplicativo nativo.
Exporte `generatePlan(profile, localDateISO, recentSessions)`, `EXERCISES`,
`getCompatibleSubstitutions` e `applySubstitution`. A data deve vir do relógio
do servidor convertido para o fuso validado do perfil. O gerador não atribui pontos.

A API persiste a primeira sugestão por usuário/data/ambiente. Uma restrição parcial
permite iniciar somente um desses planos na mesma data pessoal. Trocas no rascunho
não criam outra oportunidade de pontuar. O ciclo de atividade usa o UUID do plano
como chave idempotente e o mecanismo canônico de pontuação no servidor.

O snapshot iniciado e o conteúdo original são protegidos por trigger PostgreSQL.
Séries marcadas, descanso ajustável, notas e adaptações ficam separados no
progresso. Menos séries e alternativas mais fáceis têm a mesma conclusão
autodeclarada no desafio de constância. Cronômetro e sensores não comprovam força.

Equipamentos usam os IDs de `EQUIPMENT_LABELS`; um material ausente nunca é
presumido. Sem materiais, a seleção em casa prioriza peso corporal. As sugestões
consideram um dia de intervalo entre grupos recentemente exigidos; isso é uma
heurística de planejamento, sem diagnóstico ou prescrição individual.

As 44 ilustrações SVG são diagramas autorais por família de movimento, CC0-1.0;
não são demonstrações anatômicas de execução. Não há URLs de mídia externas.
Treinos ao ar livre remetem ao registro GPS de Atividades. A conclusão de uma
sugestão não gera quilômetros medidos; distâncias de esteira/ergométrica devem
ser manuais ou provenientes de integração compatível.

`npm test -w @consta/training` executa testes puros. Persistência, acesso por
usuário, concorrência e o trigger são cobertos pelos testes PostgreSQL da API.
Esses testes não verificam sensores, GPS real ou desempenho em aparelho.
