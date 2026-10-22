# Revisão técnica — Peace Clock

## Entrada e escopo

Base: `metadata.json` e `extension.js` colados pelo usuário nesta conversa.
O código de entrada era um protótipo funcional para GNOME 50. Esta revisão
preserva sua proposta visual; não é aprovação do GNOME Extensions.

## Achados e correções

| Achado na entrada | Tratamento |
| --- | --- |
| Leitura/decodificação síncrona de imagem no processo do Shell | Gio e GdkPixbuf assíncronos, canceláveis, com fechamento de stream |
| Troca de monitor só reposicionava | Reposicionamento seguido de análise com a nova geometria |
| Arquivo de wallpaper regravado no mesmo caminho não era observado | Gio.FileMonitor invalida a miniatura |
| Texto de um novo dia mantinha as amostras da geometria anterior | Reanálise após mudança do dia |
| Retângulos eram estimados mesmo após a alocação | Usa posições/tamanhos reais dos atores e mantém fallback inicial |
| Estilos completos repetidos no JS | Fontes/tamanhos em CSS; cores aplicadas separadamente |
| `const sombra` e espaços acumulados de patches | Removidos na reorganização; o CSS fixa `text-shadow: none` |
| Nenhum `COPYING`, crédito ou documentação no pacote enviado | GPLv3 integral, SPDX, crédito à inspiração e documentação |
| Descrição dizia apenas “estilo terracota” | Descreve comportamento atual e fonte opcional |
| Campo `version` manual | Omitido conforme orientação atual do GNOME Extensions |
| Leitura poderia terminar após desativação/troca de imagem | Cancelamento e número de requisição impedem resultados atrasados |

## Segunda validação — 22/10/2026

O usuário confirmou GNOME Shell **50.6**, compatível com a declaração `50`
do metadata. Isso confirma a versão do ambiente de destino, mas não substitui
executar esta revisão nele.

Foram corrigidos mais quatro pontos:

* A análise não incluía corretamente as faixas de fundo quando um texto ficava
  parcialmente fora da imagem. Agora cada texto é amostrado em sua própria área.
* Um horário pequeno em tela ultrawide podia ficar entre os centros dos pixels
  da miniatura e não receber amostras. A nova amostragem cobre esse caso.
* Alterações de tamanho/posição dos textos agora provocam reanálise com cache,
  sem criar um ciclo de atualizações. Os deslocamentos acompanham a escala HiDPI.
* O instalador agora prepara a atualização antes da troca, salva backup e tenta
  restaurar a pasta anterior se a troca falhar. Rejeita links simbólicos na
  instalação e respeita os diretórios XDG.

Também foi adotada a propriedade `orientation` de St.BoxLayout em lugar de
`vertical`, ainda existente, mas obsoleta no GNOME 50.

## Verificações automatizadas

**47 testes aprovados:**

* 18 testes de cor: família, tonalidade, hora mais clara, transparência, stride,
  recorte, faixas de fundo, telas ultrawide e fallback.
* 17 testes de integração com objetos simulados: inicialização sem efeitos,
  falha parcial, dez ciclos enable/disable, stream fechado, corrida entre imagens,
  cancelamento, cache, modo escuro, escala, geometria e ausência de monitor.
* 12 testes do instalador em pastas temporárias: instalação, atualização,
  backup, XDG, links simbólicos, falhas de cópia/backup/troca e recuperação.

Verificações adicionais:

* Sintaxe JavaScript validada com Node; metadata JSON e conteúdo dos ZIPs validados.
* APIs Gio/GdkPixbuf reais disponíveis no ambiente verificadas por introspecção
  e leitura/decodificação/fechamento assíncronos de PNG RGB, PNG RGBA e JPEG.
  As miniaturas decodificadas foram processadas pelo `colors.js` real no Node.
  Essa verificação usou Python/GI (GLib 2.84.4, GdkPixbuf 2.42.12), não GNOME/GJS.
* Código oficial do GNOME Shell 50 conferido para orientação, escala e ordem
  dos atores do wallpaper. Nenhum trecho desse código foi incorporado ao pacote.

## O que continua pendente

Não há GNOME Shell/GJS em execução neste ambiente. Estilo CSS, disponibilidade
da fonte, integração do ator no desktop, HiDPI, overview, bloqueio e comportamento
visual precisam ser testados no computador do usuário. Veja `CHECKLIST.md`.

O UUID local foi mantido deliberadamente e não há URL inventada de suporte.
Antes do envio, falta definir UUID com namespace sob controle do autor e adicionar
a URL válida do projeto, obrigatória para a submissão ao GNOME Extensions.
Não foram incluídos binários, fontes, wallpapers, capturas ou anexos do Patreon.

A permissão do criador relatada na conversa e a licença da fonte não foram
transformadas em uma garantia jurídica. Esta é uma revisão técnica de código.

Referências oficiais consultadas:

* https://gjs.guide/extensions/overview/anatomy.html
* https://gjs.guide/extensions/review-guidelines/review-guidelines.html
* https://gjs.guide/extensions/upgrading/gnome-shell-50.html
* https://github.com/GNOME/gnome-shell/blob/50.0/js/ui/layout.js
* https://github.com/GNOME/gnome-shell/blob/50.0/src/st/st-box-layout.c
* https://github.com/GNOME/gnome-shell/blob/50.0/src/st/st-theme-node.c
