# Batalha Naval

O clássico jogo de Batalha Naval contra o computador, direto no navegador. São três níveis de adversário, e o difícil usa um mapa de densidade de probabilidade para decidir onde atirar: em média, ele afunda a frota inteira em cerca de 44 tiros, contra cerca de 61 do médio e 95 do fácil.

**Acesse online:** https://micdog22.github.io/batalha-naval/

## Recursos

- Tabuleiro 10x10 (linhas de A a J, colunas de 1 a 10) e a frota clássica: porta-aviões (5), encouraçado (4), cruzador (3), submarino (3) e destróier (2).
- **Posicionamento manual** com prévia verde ou vermelha, giro com a tecla R, arrastar e soltar (mouse ou toque) e teclado; ou **posicionamento aleatório**.
- **Regra opcional "navios não podem se encostar"**, nem na diagonal, valendo para as duas frotas.
- **Três níveis de computador:** fácil (tiros ao acaso), médio (caça e alvo) e difícil (densidade de probabilidade sobre todas as posições possíveis).
- Mensagens a cada tiro ("água", "acertou", "afundou o cruzador"), histórico dos últimos lances e situação das duas frotas.
- **Sons** sintetizados na hora com a Web Audio API e **animações**, ambos com chave liga e desliga; as animações respeitam o "reduzir movimento" do sistema.
- **Estatísticas** salvas no navegador: partidas, vitórias, derrotas, melhor vitória e precisão.
- **Jogo completo pelo teclado** e rótulos para leitores de tela em todas as casas.

## Como usar

1. Escolha o nível e, se quiser, ligue a regra de não encostar.
2. Posicione os cinco navios: escolha um na lista (ou tecle de 1 a 5), clique na casa da proa e use R para girar. Para mudar um navio de lugar, arraste ou clique nele. "Aleatório" posiciona tudo de uma vez.
3. Clique em "Começar partida" e atire no mar inimigo. Cada lado atira uma vez por rodada.
4. No teclado: setas para andar pelo tabuleiro, Enter ou espaço para atirar (ou posicionar), Delete para recolher um navio.

## Como rodar localmente

Não há build nem dependências. Sirva a pasta por HTTP:

```bash
python3 -m http.server 8000
```

E abra http://localhost:8000.

## Testes

```bash
npm test
```

(ou `node --test`, com Node 18 ou mais novo). Os testes cobrem as regras de posicionamento (sobrepor, sair do mar, encostar na diagonal, navio torto), a validade de 400 frotas aleatórias, os resultados dos tiros, as casas descartadas pela regra de não encostar, a mira do nível médio depois de um acerto, o mapa de densidade (só mira em casas abertas, sempre na de maior densidade, e zera onde nenhum navio cabe), a ausência de tiros repetidos em todos os níveis e uma simulação com semente fixa em que o difícil precisa de menos tiros que o médio, que precisa de menos que o fácil.

## Como funciona

### Fácil: ao acaso

Escolhe qualquer casa ainda não atirada. Como a frota ocupa 17 das 100 casas, ele precisa, em média, de uns 95 tiros: quase o mar inteiro.

### Médio: caça e alvo

Enquanto não tem acerto pendente, atira ao acaso (caça). Quando acerta, passa a mirar nas quatro vizinhas da casa atingida (alvo) e, se já tem dois acertos em linha, prefere continuar a linha. Quando o navio afunda, volta a caçar. Média de uns 61 tiros.

### Difícil: densidade de probabilidade

A cada tiro, o computador olha para os navios que ainda flutuam e, para cada um, percorre todas as posições possíveis no tabuleiro (um navio de tamanho k tem `2 × 10 × (10 - k + 1)` posições). Descarta as que passam por uma casa de água já atirada ou por um navio afundado. Cada posição que sobra soma 1 ponto em cada casa desconhecida que ocupa. A casa com mais pontos é a que mais formas tem de esconder um navio, e é nela que ele atira.

Com um acerto pendente, só contam as posições que passam pelo acerto, com peso que multiplica a cada acerto coberto. Assim, depois do primeiro acerto ele testa a direção mais provável, e depois do segundo ele segue a linha.

Com a regra de não encostar ligada, ele usa mais informação: as casas em volta de um navio afundado e as diagonais de um acerto não podem ter navio, e uma posição que não cobre um acerto pendente também não pode encostar nele.

No começo da partida, esse mapa é maior no centro e menor nas bordas e nos cantos (um canto só recebe navios em duas direções), o que dá ao difícil um padrão de busca bem mais eficiente. Nos testes, com 150 partidas e semente fixa, ele precisa de uns 44 tiros em média, e de uns 39 com a regra de não encostar.

### Sorteio e áudio

A frota do computador e os desempates entre casas usam `crypto.getRandomValues`. Para o posicionamento aleatório, cada navio (do maior para o menor) sorteia uma posição entre todas as válidas, com a mesma chance para cada uma. Os sons são feitos na hora: água é um ruído branco passando por um filtro passa-faixa que desce de 2200 Hz para 300 Hz; o acerto é uma senoide que despenca de 140 Hz para 45 Hz junto com um estouro de ruído filtrado.

## Estrutura

```
index.html        página
styles.css        estilos (tema claro e escuro)
src/game.js       motor puro: tabuleiro, regras, tiros e estratégias do computador
src/sound.js      efeitos sonoros com Web Audio
src/app.js        interface
tests/            testes com node:test
```

## Contribuindo

Issues e pull requests são bem-vindos.

## Licença

MIT. Veja [LICENSE](LICENSE).
