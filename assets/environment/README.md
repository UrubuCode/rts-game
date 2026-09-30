# Distrito industrial

Modelos originais gerados por `python tools/create_environment.py`:
caixote reforçado, contêiner nervurado, torre com fachadas e pavimentação urbana.
Sem downloads, texturas externas ou dependências de ferramentas 3D.

Os três modelos de objetos usam a caixa unitária centrada na origem e recebem
a transformação do objeto existente. Fachadas sobressaem no máximo 0,004 unidade
local. A pavimentação acompanha a grade atual de 9 × 9 blocos de 40 unidades.
As superfícies ficam entre 0,008 e 0,02 unidade acima do chão.

Geometria visual carregada apenas pelo cliente; colisões, spawns e simulação
permanecem no mapa compartilhado. Materiais agrupados reduzem chamadas de desenho.
Validação estrutural: `python tools/test_environment.py`.
