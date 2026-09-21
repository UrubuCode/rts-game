# Convenções deste projeto

## Interface do editor

- Centralize medidas de layout, limites de painéis, espaçamentos, rótulos de menus e cores em `src/editor/ui_config.ts`. Não espalhe esses valores por `main.ts` ou por widgets novos.
- Não introduza números mágicos para posicionamento. Expresse posições derivadas a partir de medidas nomeadas. Exemplo: o início da lista da Hierarquia é `UI_BAR_H + UI_HIER_HEADER_H + UI_HIER_SEARCH_H`, não `UI_BAR_H + 82`.
- Use nomes semânticos para estados visuais (como `UI_C.toolHover` e `UI_C.toolIdle`) em vez de literais hexadecimais dentro de condições ou chamadas de desenho.
- Reutilize as mesmas constantes para desenho e detecção de mouse; a área clicável deve acompanhar o elemento visível quando uma medida mudar.
- Valores de estado que o usuário pode modificar (largura dos painéis, ferramenta selecionada, filtro) continuam mutáveis no editor; seus padrões e limites ficam na configuração.
- Constantes de matemática, física e renderização 3D não pertencem ao tema visual; mantenha-as próximas do sistema correspondente, também com nomes quando não forem óbvias.
- Ao alterar a UI, verifique a compilação e, quando possível, o comportamento visual e de interação na janela do editor.
- O seletor de componentes usa `src/editor/component_catalog.ts` como fonte única de nomes, categorias, descrições e termos de busca. Novos componentes precisam também de fábrica em `components.ts`; não mantenha listas paralelas no desenho da UI.
- Widgets de seleção devolvem a escolha; a mutação da cena e o snapshot de Desfazer/Refazer ficam no editor. Cubra busca, categorias, navegação e estado vazio com testes sem janela.

## Criação de objetos

- Para objetos novos criados pelo editor, use `scene.createGameObject(...)`. A cena deve cuidar de instanciar, registrar, montar e manter os caches sincronizados. Deixe os presets de menu e a posição inicial no editor.
- Mantenha os presets do menu Criar em `src/editor/object_presets.ts`. O menu global, o menu de contexto e a criação devem ler os mesmos registros; não copie rótulos, tipos de malha ou cores para cada menu.
- Use `scene.add(...)` para objetos já construídos (por exemplo, desserialização ou clone), sem recriá-los.
