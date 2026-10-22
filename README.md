# Peace Clock

Relógio discreto para a área de trabalho do GNOME Shell 50: hora pequena,
dia da semana grande em inglês e duas cores derivadas do Gruvbox. A hora
permanece mais clara que o dia, com o mesmo matiz e sem sombra ou contorno.

O tamanho, alinhamento, espaçamento e centralização foram mantidos da versão
local enviada pelo autor. A coleta de cores agora usa as posições reais dos
textos quando o GNOME já concluiu o layout. Os deslocamentos verticais acompanham
a escala HiDPI para conservar o espaçamento.

## Estado desta revisão

Este é um pacote para **teste local no GNOME 50**. Os testes automatizados
verificam a análise de cores e o ciclo de vida com objetos simulados. Não houve
teste de renderização em uma sessão real de GNOME neste ambiente.
Consulte `CHECKLIST.md` antes de enviar ao extensions.gnome.org.

O nome público é Peace Clock. O identificador `relogio-desktop@local` foi
mantido para atualizar a instalação existente. Para a publicação, defina um
UUID com namespace sob seu controle e adicione uma URL válida do projeto ao
campo `url` de `metadata.json`: a URL é obrigatória no GNOME Extensions.
Alterar o UUID cria uma extensão diferente; nesse caso, desative a versão local
para evitar dois relógios. Não foi inventado um usuário ou repositório.
O campo `version` foi removido: o site atribui a versão publicada.

Requisitos de metadata: https://gjs.guide/extensions/overview/anatomy.html

## Fonte

Clash Display é opcional. Se estiver instalada, mantém o visual já usado no
seu computador. Caso contrário, o Pango usa uma fonte disponível no sistema.
Nenhuma fonte é baixada, instalada ou incluída neste pacote.

Para distribuir um arquivo da Clash Display no futuro, confira a licença que
acompanha o download no Fontshare. A licença GPL do código não cobre essa fonte.

## Instalação de teste com backup

Extraia `peace-clock-fonte.zip`. Abra o terminal na pasta extraída e execute:

```bash
python3 install-local.py
```

O instalador salva um ZIP da versão atual em `~/.local/state/peace-clock/` e
prepara os cinco arquivos de execução antes de substituir a instalação.
Em caso de falha na substituição, tenta restaurar a pasta anterior. Ele preserva
arquivos extras existentes e não apaga seus backups antigos. Também respeita
`XDG_DATA_HOME` e `XDG_STATE_HOME` quando definidos como caminhos absolutos.
Não altera o wallpaper e não requer sudo.

Depois **saia da sessão e entre novamente**. Essa etapa carrega os módulos e
o stylesheet novos no GNOME/Wayland. Ative, se necessário:

```bash
gnome-extensions enable relogio-desktop@local
```

Alternativa: o ZIP `peace-clock-teste.shell-extension.zip` é instalável pelo
comando abaixo, mas esse comando não faz o backup adicional do instalador:

```bash
gnome-extensions install --force ~/Downloads/peace-clock-teste.shell-extension.zip
```

Para restaurar o backup, use `gnome-extensions install --force` com o caminho
do ZIP de backup informado pelo instalador e entre novamente na sessão.

## Como funciona

* `extension.js` cria os textos e conecta eventos somente em `enable()`.
* A imagem local é lida e decodificada de forma assíncrona. Mudanças rápidas
  cancelam o trabalho anterior; resultados antigos não alteram o relógio.
* A miniatura é reutilizada quando apenas a geometria muda. Mudanças na área dos
  textos também provocam nova análise, sem repetir a leitura da imagem.
  Um monitor de arquivo
  invalida o cache se o wallpaper for regravado no mesmo caminho.
* `colors.js` recebe pixels, geometria e cor de fundo. Ele reconhece a família
  cromática nos pixels coloridos, suaviza os tons com neutros do Gruvbox e avalia
  o fundo atrás de cada texto, incluindo as faixas de fundo nas bordas de uma
  imagem ajustada à tela.
* A escolha final é um **par**: mesmo matiz e saturação, com luminosidade HSL da
  hora 0,16 acima da do dia. O contraste ajusta o par inteiro, sem inverter os tons.
* `stylesheet.css` guarda fonte e tamanhos; apenas a cor muda em tempo de execução.
* `disable()` remove timers e conexões, cancela leituras/monitoramento, destrói
  os atores e libera a miniatura. Leituras já iniciadas fecham seu stream ao sair.

Não há telemetria, subprocessos, downloads de fontes ou acesso a wallpapers remotos.

## Limites conhecidos

* Apenas o monitor principal recebe o relógio.
* A análise da imagem suporta os modos GNOME `zoom`, `scaled` e `stretched`.
  Em `centered`, `wallpaper` (mosaico), `spanned` e `none`, usa-se a cor de fundo
  principal como alternativa, sem presumir uma geometria incorreta.
* XML de apresentação, wallpapers animados, arquivos ausentes/ilegíveis e imagens
  não suportadas também usam essa alternativa. Gradientes são aproximados pela
  cor principal. A fonte alternativa pode mudar as proporções das letras.
* Uma única cor plana não garante legibilidade sobre todos os prédios claros e
  escuros de uma foto. As metas de contraste orientam a escolha, mas não constituem
  uma garantia de conformidade de acessibilidade.
* O relógio atualiza hora/dia a cada dez segundos, como a versão original.
* O uso de `Main.layoutManager._backgroundGroup` depende de uma API interna do
  Shell. Só GNOME 50 está declarado; outras versões exigem teste e revisão.
* Não há painel de preferências nesta primeira versão.

## Desenvolvimento

Com Node.js 20 ou mais recente:

```bash
node tests/colors.test.js
node tests/lifecycle.test.js
node --check extension.js
node --check colors.js
python3 -m unittest discover -s tests -p 'test_*.py' -v
python3 build.py
```

Os testes de ciclo de vida usam objetos GNOME simulados e não substituem o teste
visual no GNOME. O ZIP de execução contém somente `extension.js`, `colors.js`,
`stylesheet.css`, `metadata.json` e `COPYING`; testes, instalador e documentos
de desenvolvimento ficam fora dele.

## Créditos e licença

Inspiração visual: **Sands Conky**, de **Arc Technologies (arcnations)**:
https://www.patreon.com/arcnations/posts/sands-conky-143984982

Esta implementação para GNOME Shell é independente da configuração Conky.
Nenhum arquivo do Conky, imagem do post ou fonte do criador integra o pacote.

Código: **GPL-3.0-or-later**, com texto integral da GPLv3 em `COPYING`.
Os testes e ferramentas do repositório seguem a mesma licença.

O projeto foi desenvolvido com assistência de IA. O responsável pela submissão
precisa revisar, entender e conseguir explicar o código, conforme as regras de
revisão do GNOME Extensions; esta revisão não substitui essa responsabilidade.
