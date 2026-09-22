# Inspector e simulacao

Os novos controles do Inspector e de Rodar/Pausar/Parar sao GameObjects de uma
UIScene separada. Cada controle tem um EditorControl anexado; o Transform guarda
seu retangulo. EditorUI reutiliza os objetos pelo caminho, oculta os controles
que nao participaram do frame e respeita a visibilidade dos ancestrais.

O ComponentPicker e um componente de UI composto. Ele devolve a escolha; o
Inspector modifica a cena e registra Desfazer. Os campos de cada componente
sao derivados da classe pelo gerador, incluindo number/boolean/string. Veja
[Componentes definidos por scripts](components.md). Overrides manuais permanecem
para inspectores personalizados legados.

As medidas, rotulos e cores ficam em src/editor/ui_config.ts. O Inspector tem
cabecalho e rodape fixos, rolagem unica e secoes recolhiveis. Os paineis antigos
(menus, Hierarquia e Project) ainda usam desenho imediato; esta etapa nao os
migra para EditorUI.

Rodar valida e cria copias dos GameObjects e componentes. Pausar conserva essa
cena temporaria. Parar restaura as referencias originais, selecao, iluminacao e
historico. Componentes sem serializacao/fabrica de copia recusam Rodar antes de
alterar a cena. Salvar e Build ficam bloqueados durante a simulacao.

## Testes sem janela

Execute a partir da raiz do checkout, com o CLI RTS disponivel:

```powershell
rts.exe run tests/test_editor_ui.ts
rts.exe run tests/test_play_mode.ts
rts.exe run tests/test_component_picker.ts
rts.exe run tests/test_component_browser.ts
rts.exe run tests/test_component_factory.ts
rts.exe run tests/test_scene_create.ts
rts.exe run tests/test_project_tree.ts
rts.exe run tests/claude-test-sceneio-roundtrip.ts
```

## Verificacao na janela

1. Selecione um objeto; edite X e confirme com Enter. Desfazer deve restaurar X.
2. Abra Adicionar componente, navegue pelas categorias e adicione um Rigidbody.
3. Role o Inspector: o nome do objeto e Adicionar componente ficam acessiveis.
4. Rode, pause e pare: Parar deve restaurar a pose anterior a Rodar.
5. Confira que Salvar/Build ficam desabilitados durante Rodar e Pausar.

O executavel de previa precisa viajar com RTSEditor.rtsdata, assets/ e scenes/.
A acao Build do jogo ainda depende do checkout/SDK e nao e uma funcao standalone
deste pacote de previa do editor.
