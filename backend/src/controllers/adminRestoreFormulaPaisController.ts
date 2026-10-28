import { googleSheetsService } from "../services/googleSheetsService";

// Restauração pontual (2026-10-28): ÁFRICA DO SUL e ALEMANHA tiveram A2
// sobrescrita com o texto literal "PAÍS" (provavelmente clique/arraste
// acidental puxando o cabeçalho da linha 1 pra baixo) depois que a correção
// de locale (fix-formula-pais-locale) já tinha gravado a fórmula certa
// nelas — confirmado comparando com BRASIL, corrigida no mesmo lote e
// intacta. Escreve direto o texto já corrigido (pt_BR, ";"/",") capturado
// antes da corrupção, sem reler a célula atual (que está com lixo).
const FORMULAS: Record<string, string> = {
  "ÁFRICA DO SUL":
    '={IFERROR(LET(n; "ÁFRICA DO SUL"; pb; 0,005; r; 0,20100502512562815; b; 0,2; d; SPOTIFY!B:B; m; SPOTIFY!C:C; s; SPOTIFY!E:E; h; SPOTIFY!H:L; nacs; MAP(h; LAMBDA(art; IFERROR(VLOOKUP(art; \'INFOS ACTS\'!A:N; 14; 0); ""))); nat; BYROW(nacs; LAMBDA(row; IF(COUNTIF(row; n) > 0; 1; 0))); pf; MAP(nat; LAMBDA(v; IF(v = 1; pb + b; pb * (1 - r)))); sc; MAP(s; pf; LAMBDA(st; w; st * w)); res; QUERY(HSTACK(m; sc; d; pf); "select \'"&n&"\', 0, \'"&"SPOTIFY"&"\', Col1, Col2, Col3, Col4 where Col3 contains \'2026\' order by Col2 desc limit 50"; 0); HSTACK(CHOOSECOLS(res; 1); SEQUENCE(ROWS(res)); CHOOSECOLS(res; 3; 4; 5; 6; 7))); {"";"";"";"";"";"";""});IFERROR(LET(n; "ÁFRICA DO SUL"; pb; 0,007; r; 0,2014098690835851; b; 0,2; d; \'APPLE MUSIC\'!B:B; m; \'APPLE MUSIC\'!C:C; s; \'APPLE MUSIC\'!E:E; h; \'APPLE MUSIC\'!H:L; nacs; MAP(h; LAMBDA(art; IFERROR(VLOOKUP(art; \'INFOS ACTS\'!A:N; 14; 0); ""))); nat; BYROW(nacs; LAMBDA(row; IF(COUNTIF(row; n) > 0; 1; 0))); pf; MAP(nat; LAMBDA(v; IF(v = 1; pb + b; pb * (1 - r)))); sc; MAP(s; pf; LAMBDA(st; w; st * w)); res; QUERY(HSTACK(m; sc; d; pf); "select \'"&n&"\', 0, \'"&"APPLE MUSIC"&"\', Col1, Col2, Col3, Col4 where Col3 contains \'2026\' order by Col2 desc limit 50"; 0); HSTACK(CHOOSECOLS(res; 1); SEQUENCE(ROWS(res)); CHOOSECOLS(res; 3; 4; 5; 6; 7))); {"";"";"";"";"";"";""});IFERROR(LET(n; "ÁFRICA DO SUL"; pb; 0,008; r; 0,20161290322580647; b; 0,2; d; YOUTUBE!B:B; m; YOUTUBE!C:C; s; YOUTUBE!E:E; h; YOUTUBE!H:L; nacs; MAP(h; LAMBDA(art; IFERROR(VLOOKUP(art; \'INFOS ACTS\'!A:N; 14; 0); ""))); nat; BYROW(nacs; LAMBDA(row; IF(COUNTIF(row; n) > 0; 1; 0))); pf; MAP(nat; LAMBDA(v; IF(v = 1; pb + b; pb * (1 - r)))); sc; MAP(s; pf; LAMBDA(st; w; st * w)); res; QUERY(HSTACK(m; sc; d; pf); "select \'"&n&"\', 0, \'"&"YOUTUBE"&"\', Col1, Col2, Col3, Col4 where Col3 contains \'2026\' order by Col2 desc limit 50"; 0); HSTACK(CHOOSECOLS(res; 1); SEQUENCE(ROWS(res)); CHOOSECOLS(res; 3; 4; 5; 6; 7))); {"";"";"";"";"";"";""})}',
  ALEMANHA:
    '={IFERROR(LET(n; "ALEMANHA"; pb; 0,065; r; 0,21390374331550802; b; 0,2; d; SPOTIFY!B:B; m; SPOTIFY!C:C; s; SPOTIFY!E:E; h; SPOTIFY!H:L; nacs; MAP(h; LAMBDA(art; IFERROR(VLOOKUP(art; \'INFOS ACTS\'!A:N; 14; 0); ""))); nat; BYROW(nacs; LAMBDA(row; IF(COUNTIF(row; n) > 0; 1; 0))); pf; MAP(nat; LAMBDA(v; IF(v = 1; pb + b; pb * (1 - r)))); sc; MAP(s; pf; LAMBDA(st; w; st * w)); res; QUERY(HSTACK(m; sc; d; pf); "select \'"&n&"\', 0, \'"&"SPOTIFY"&"\', Col1, Col2, Col3, Col4 where Col3 contains \'2026\' order by Col2 desc limit 50"; 0); HSTACK(CHOOSECOLS(res; 1); SEQUENCE(ROWS(res)); CHOOSECOLS(res; 3; 4; 5; 6; 7))); {"";"";"";"";"";"";""});IFERROR(LET(n; "ALEMANHA"; pb; 0,055; r; 0,21164021164021166; b; 0,2; d; \'APPLE MUSIC\'!B:B; m; \'APPLE MUSIC\'!C:C; s; \'APPLE MUSIC\'!E:E; h; \'APPLE MUSIC\'!H:L; nacs; MAP(h; LAMBDA(art; IFERROR(VLOOKUP(art; \'INFOS ACTS\'!A:N; 14; 0); ""))); nat; BYROW(nacs; LAMBDA(row; IF(COUNTIF(row; n) > 0; 1; 0))); pf; MAP(nat; LAMBDA(v; IF(v = 1; pb + b; pb * (1 - r)))); sc; MAP(s; pf; LAMBDA(st; w; st * w)); res; QUERY(HSTACK(m; sc; d; pf); "select \'"&n&"\', 0, \'"&"APPLE MUSIC"&"\', Col1, Col2, Col3, Col4 where Col3 contains \'2026\' order by Col2 desc limit 50"; 0); HSTACK(CHOOSECOLS(res; 1); SEQUENCE(ROWS(res)); CHOOSECOLS(res; 3; 4; 5; 6; 7))); {"";"";"";"";"";"";""});IFERROR(LET(n; "ALEMANHA"; pb; 0,028; r; 0,205761316872428; b; 0,2; d; YOUTUBE!B:B; m; YOUTUBE!C:C; s; YOUTUBE!E:E; h; YOUTUBE!H:L; nacs; MAP(h; LAMBDA(art; IFERROR(VLOOKUP(art; \'INFOS ACTS\'!A:N; 14; 0); ""))); nat; BYROW(nacs; LAMBDA(row; IF(COUNTIF(row; n) > 0; 1; 0))); pf; MAP(nat; LAMBDA(v; IF(v = 1; pb + b; pb * (1 - r)))); sc; MAP(s; pf; LAMBDA(st; w; st * w)); res; QUERY(HSTACK(m; sc; d; pf); "select \'"&n&"\', 0, \'"&"YOUTUBE"&"\', Col1, Col2, Col3, Col4 where Col3 contains \'2026\' order by Col2 desc limit 50"; 0); HSTACK(CHOOSECOLS(res; 1); SEQUENCE(ROWS(res)); CHOOSECOLS(res; 3; 4; 5; 6; 7))); {"";"";"";"";"";"";""})}',
};

export async function adminRestoreFormulaPaisController(): Promise<Response> {
  const resultados: Record<string, { gravado: boolean; erro?: string }> = {};
  for (const [sheet, formula] of Object.entries(FORMULAS)) {
    try {
      const ok = await googleSheetsService.chartsBase.updateValues(sheet, "A2:A2", [[formula]]);
      resultados[sheet] = { gravado: ok };
    } catch (err) {
      resultados[sheet] = { gravado: false, erro: err instanceof Error ? err.message : String(err) };
    }
  }
  return new Response(JSON.stringify({ success: true, resultados }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
