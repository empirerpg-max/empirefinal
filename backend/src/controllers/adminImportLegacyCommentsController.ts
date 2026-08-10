import { googleSheetsService } from "../services/googleSheetsService";

/**
 * Endpoint TEMPORÁRIO de importação única — comentários reais do histórico
 * do Telegram (exports "EMPIRE: Músicas" e "EMPIRE: Vídeos") que nunca
 * foram gravados em Comentarios_Musicas/Comentarios_MV. Calculado e
 * validado fora do app (tópico confirmado existente na planilha, sem
 * duplicidade com o que já estava lá). Roda uma vez e este arquivo é
 * removido depois — não é uma rota permanente da API.
 */

interface LegacyCommentRow {
  topicId: string;
  jogadorId: string;
  jogador: string;
  comentario: string;
  data: string;
}

const MUSICAS_ROWS: LegacyCommentRow[] = [
  { topicId: "1580", jogadorId: "5610611492", jogador: "Chris Aurieme", comentario: "é uma musica sobre finalmente entender algo, compreender que a vida é desse jeito, as vezes igual ontem, outras vezes diferente. Você decide pra onde vai, como faz, o que é... É uma composição muito inteligente. Eu amei a melodia, é moderna, é country, é livre, é rebelde. Adorei esse contraste do Paul com a Rayna, funcionou bem.", data: "26/07/2026" },
  { topicId: "1673", jogadorId: "5610611492", jogador: "Chris Aurieme", comentario: "Viva o capitalismo, o consumo, o pay per view. que critica direta e muito bem estruturada à exposição diaria por recompensas. Essa musica traz um caos para melodia em uma letra muito bem pensada. Um verdadeiro hit.", data: "04/08/2026" },
  { topicId: "1691", jogadorId: "5610611492", jogador: "Chris Aurieme", comentario: "Genial. Essa faixa mostrando toda sua rebeldia e direcionando a origem dela para uma personalidade extremamente conhecida.  Senti que essa faixa ficou mais pop que seus trabalhos anteriores, um pouco mais jovial, mas ainda sim é muito boa e divertida.", data: "26/07/2026" },
  { topicId: "2024", jogadorId: "1065444507", jogador: "Weuller Collins", comentario: "Caramba, eu tinha visto a letra no álbum, mas agora vendo ela separada aqui como single achei ela bem mais potente. Sucesso roa nossa latina!", data: "26/07/2026" },
  { topicId: "2024", jogadorId: "1854891008", jogador: "Drico Branco", comentario: "Que letra foda! Super me conectei ao refrão, principalmente. Que delicia de reggaeton e que letra potente, carregada de sentimento e potencia nos versos. Amei o que você fez ao trazer um verso como renascimento, reescrevendo o verso 1 com uma nova roupagem. Arrasou demais nessa faixa e me deixou ansioso pra conferir o album. Parabens demais.. a faixa pe pegou mesmo.", data: "29/07/2026" },
  { topicId: "2024", jogadorId: "7278505786", jogador: "lucas barbosa", comentario: "Essa aqui é bem intensa e quase um manifesto. A música fala sobre se perder tentando caber em um lugar que nunca foi seu e depois se reconstruir a partir disso. Gosto muito da virada pra esse sentimento de consciência e força no final. É dolorida, mas também muito poderosa.", data: "04/08/2026" },
];

const MV_ROWS: LegacyCommentRow[] = [
  { topicId: "1129", jogadorId: "7528860755", jogador: "Filipe TED", comentario: "gente? o comercial da TIM! É um clipe bem 2010 né, bem fofinho e simples, mas me irrita o tempo todo ser essas faixas de música, vamos sair do quarto e gravar em estúdio de verdade Mattzinho!", data: "29/07/2026" },
  { topicId: "1129", jogadorId: "1065444507", jogador: "Weuller Collins", comentario: "Eu não conhecia esse single, esse vídeo pra mim é ótimo, essa estética de reprodutor de música dos anos 2000 faz todo sentido com a pegada do instrumental, ainda não vi a letra, mas tenho certeza que faz sentido aqui. \nParabéns!!", data: "05/08/2026" },
  { topicId: "1632", jogadorId: "7528860755", jogador: "Filipe TED", comentario: "gente o gemido no começo........ \n\nAMIGA EU AMEI ESSE CLIPE, acho interessante o quanto você dá vida nas suas músicas através dos visuais e aqui não é diferente, é um clipe bem replay value e com uma edição deliciossima. amei.", data: "29/07/2026" },
  { topicId: "1632", jogadorId: "5610611492", jogador: "Chris Aurieme", comentario: "um clipe cheio de carão, close e atitude. Alexxa, eu amo quando você volta, porque vc é muito superior, o tempo todo. Esse clipe é um arraso sem fim. Cade seu superbowl?", data: "04/08/2026" },
  { topicId: "1632", jogadorId: "7278505786", jogador: "lucas barbosa", comentario: "Alexxa nunca deixa a desejar nos visuais dos seus singles, né? Que bom que você consegue nos trazer sempre arte junto com sua musicalidade", data: "04/08/2026" },
  { topicId: "1632", jogadorId: "1065444507", jogador: "Weuller Collins", comentario: "Lide com isso! Eu amo tanto tudo que você entrega. Eu literalmente me delicio com cada escolha que você faz pq sempre faz total sentido com a proposta e com Deal with it não poderia ser diferente. A edição maravilhosa e o visual perfeito. Sem mais", data: "05/08/2026" },
  { topicId: "1644", jogadorId: "7528860755", jogador: "Filipe TED", comentario: "gente? o clipe caseirissimo, cortaram o budget??? é um clipe bem simples e mas pra mostrar o carisma do nosso divo né? enfim, a edição ficou ótima!", data: "29/07/2026" },
  { topicId: "1644", jogadorId: "5610611492", jogador: "Chris Aurieme", comentario: "gravado diretamente do android kitkat 4.1. O clipe é simples e intimo, assim como a letra exige. VocE^se curtindo, se mostrando é a letra sendo narrada, trazendo seu conforto e desafio em ser quem é. Eu não imaginaria um clipe melhor", data: "04/08/2026" },
  { topicId: "1658", jogadorId: "1065444507", jogador: "Weuller Collins", comentario: "Que vídeo lindo. É algo simples mas bem pensado demais. A edição tá boa, e me choca que você só colocou o vídeo e música e fez poucos ajustes.\nRobyn sempre será uma escolha perfeita então tudo pra mim funciona aqui. Incrível", data: "05/08/2026" },
  { topicId: "1661", jogadorId: "1065444507", jogador: "Weuller Collins", comentario: "Uai amigo colocou os dois vídeos juntos? Kkkk vou comentar aqui depois colo no outro também pra valer. Eu amo quando tem um fio narrativo na história e um estética bem pensada. Loreena traz um apuro visual incrível aqui. Onde em El Nino temos introdução metafórica para a histórica e yo tambien cai temos uma conclusão com algo mais pessoal. A cena do corpo se tornando cacto é linda demais", data: "05/08/2026" },
  { topicId: "1664", jogadorId: "1065444507", jogador: "Weuller Collins", comentario: "Uai amigo colocou os dois vídeos juntos? Kkkk vou comentar aqui depois colo no outro também pra valer. Eu amo quando tem um fio narrativo na história e um estética bem pensada. Loreena traz um apuro visual incrível aqui. Onde em El Nino temos introdução metafórica para a histórica e yo tambien cai temos uma conclusão com algo mais pessoal. A cena do corpo se tornando cacto é linda demais", data: "05/08/2026" },
  { topicId: "1632", jogadorId: "5610611492", jogador: "Chris Aurieme", comentario: "Caraca, como Alexxa é uma artista fora da curva, irreverente. Eu adoro que você sempre traz algo que ninguem espera, mas sempre é a sua cara. Aqui, você não quer ensinar, apesar se não aceitar menos que ser o comando. eu fiquei gag nos dois segundos pós refrão com uma leve batidinha de funk, achei. rs arrasou", data: "26/07/2026" },
  { topicId: "1632", jogadorId: "1065444507", jogador: "Weuller Collins", comentario: "Alexxa sempre sinônimo de qualidade. Aqui você canetou demais no \"eu não sou professora, não tô aqui pra ensinar\". O instrumentação é um luxo a parte. Você entrega tudo que esperamos de alexxa com uma a excelência a cada lançamento", data: "29/07/2026" },
  { topicId: "1632", jogadorId: "7528860755", jogador: "Filipe TED", comentario: "A ROUBADORA DE SAMPLES CHEGOU! Amei essa música e a forma como você expande mais a era villain nela, ela se encaixa perfeitamente no conceito do álbum desde a música até a própria produção. Um hit pronto mesmo.", data: "29/07/2026" },
  { topicId: "1632", jogadorId: "7278505786", jogador: "lucas barbosa", comentario: "E entrega o indie sleazy por favor!!! Alexxa nos entrega uma composição ótima numa batida mais uma vez suja, mas que não esgota nem cansa seu repertório, só o expande.", data: "04/08/2026" },
  { topicId: "1637", jogadorId: "5610611492", jogador: "Chris Aurieme", comentario: "Que linda essa canção. Perceber que o tempo passou e a pessoa que mais fez sentido na sua vida não acompanhou, doi, mas também faz crescer. eu achei lindissima. Seus vocais são tão lindos, cheios de sentimentos e uma crescente até o refrão encher a gente do sentimento. Eu achei a primeira parte da melodia tão linda e unica, e depois ela dá uma popzada bem legal, mas não foge da ideia melancolia, mas mostra que vc tem pontos para mostrar que mudou também.", data: "26/07/2026" },
  { topicId: "1644", jogadorId: "1854891008", jogador: "Drico Branco", comentario: "Marcolino, meu amigo! Home é uma música muito potente e é um statement de quem você é e mesmo respirando fumaça e cruzando com corpos e esquinas você tenta se manter fiel a quem é. O instrumental é bem gostoso de ouvir, bem construído e amarra muito bem todo esse conceito meio libertário que a faixa quer passar. Ansioso pra ver o que mais vem por ai depois desse lead. Parabéns, amigo. <3", data: "29/07/2026" },
  { topicId: "1644", jogadorId: "7528860755", jogador: "Filipe TED", comentario: "A farofada.... eu adorei a música e é uma música muito bem produzida né? Me lembra os hits de 2018/2019, acho que combina bastante com você e a letra em si é muito boa, que você explore mais esse amadurecimento lírico também em outras produções mais diferentes, gostei!", data: "29/07/2026" },
  { topicId: "1644", jogadorId: "5610611492", jogador: "Chris Aurieme", comentario: "Nossa, essa musica é um hino pqp. Essa guitarrinha iniciando e as batidas que vão chegando, vão construindo uma musica misteriosa e convitativa. Delicia demais esse refrão, é super chiclete. A letra é uma incrivel metafora sobre construir quem você é com as experiencias com pessoas diversas, mas sempre voltando à um lugar que é só seu, seu lar, em seu corpo. que foda.", data: "04/08/2026" },
  { topicId: "1658", jogadorId: "1854891008", jogador: "Drico Branco", comentario: "Que delicinha de instrumentaaaaal e que delicinha de música pra dar uma dançadinha e sofrer de saudades. A composição é linda, carregada de sentimentos e nostalgia de um \"quase\". O instrumental intensifica esse sentimento deixando a faixa ainda mais completa. Arrasou demais, Ray! Vem muito ai.", data: "29/07/2026" },
  { topicId: "1658", jogadorId: "5610611492", jogador: "Chris Aurieme", comentario: "Rayna vem apresentando os primeiros sintomas da fama, quando descreve que sente falta de alguem que não veio junto com a fama, que saiu assim que ela entrou. Essa metafora pode ser pra varias coisas, como uma pessoa fazer parte de toda sua jornada, mas não esta ali na entrega do premio. Que melodia delicada e sentimental, eu estou apaixonado.]", data: "04/08/2026" },
  { topicId: "1685", jogadorId: "1854891008", jogador: "Drico Branco", comentario: "Mds que canetada! Cowboy Fresh chegou mesmo trazendo uma freshness latina que eu amei. Esse instrumental casou muito com essa letra melancólica e cheia de sentimento. Me conectei com muitos trechos e adorei a forma crua como você compartilhou sua vulnerabilidade tão de cara assim. Arrasou e ansioso pelo que mais você vai trazer pra gente.", data: "09/08/2026" },
];

export async function importLegacyCommentsController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (token !== "empireplay-legacy-import-2026") {
    return new Response(JSON.stringify({ success: false, error: "Não autorizado." }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const results = { musicas: 0, mv: 0, errors: [] as string[] };

  for (const row of MUSICAS_ROWS) {
    try {
      await googleSheetsService.principal.appendRow("Comentarios_Musicas", [
        row.topicId,
        row.jogadorId,
        row.jogador,
        row.comentario,
      ]);
      results.musicas++;
    } catch (err: any) {
      results.errors.push(`Musicas ${row.topicId}/${row.jogador}: ${err.message}`);
    }
  }

  for (const row of MV_ROWS) {
    try {
      await googleSheetsService.principal.appendRow("Comentarios_MV", [
        row.topicId,
        row.jogadorId,
        row.jogador,
        row.comentario,
        row.data,
      ]);
      results.mv++;
    } catch (err: any) {
      results.errors.push(`MV ${row.topicId}/${row.jogador}: ${err.message}`);
    }
  }

  return new Response(JSON.stringify({ success: true, data: results }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
