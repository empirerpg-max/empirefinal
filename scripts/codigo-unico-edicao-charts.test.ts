import { describe, expect, test } from "bun:test";
import {
  analisarFormulaBD,
  codigoDaFormulaParaLinha,
  codigoMusicaParaLinha,
  podeGravarCodigoNaLinha,
} from "../backend/src/services/codigoUnicoEdicaoCharts";

describe("analisarFormulaBD", () => {
  test("ARRAYFORMULA aberta (B2:B) não deixa gravar por cima", () => {
    const e = analisarFormulaBD([
      "Código único",
      '=ARRAYFORMULA(IF(B2:B="";"";"EMP"&TEXT(ROW(B2:B)-1;"000")))',
      "",
    ]);
    expect(e.tipo).toBe("arrayformula-aberta");
    expect(podeGravarCodigoNaLinha(e, 1065)).toBe(false);
  });

  test("ARRAYFORMULA limitada só libera depois do fim", () => {
    const e = analisarFormulaBD([
      "Código único",
      '=ARRAYFORMULA(IF($B$2:$B$1064="";"";"EMP"&TEXT(ROW(B2:B1064)-1;"000")))',
    ]);
    expect(e).toMatchObject({ tipo: "arrayformula-limitada", ultimaLinha: 1064 });
    expect(podeGravarCodigoNaLinha(e, 1064)).toBe(false);
    expect(podeGravarCodigoNaLinha(e, 1065)).toBe(true);
  });

  test("sem ARRAYFORMULA (valores fixos) deixa gravar", () => {
    const e = analisarFormulaBD(["Código único", "EMP001", "EMP002"]);
    expect(e.tipo).toBe("sem-arrayformula");
    expect(podeGravarCodigoNaLinha(e, 1065)).toBe(true);
  });
});

describe("codigoMusicaParaLinha", () => {
  test("segue o padrão da fórmula (linha - 1)", () => {
    expect(codigoMusicaParaLinha(1066, ["EMP1063"])).toBe("EMP1065");
    expect(codigoMusicaParaLinha(5, [])).toBe("EMP004");
  });

  test("código já usado vira maior + 1", () => {
    expect(codigoMusicaParaLinha(1066, ["EMP1063", "EMP1065", "EMPALBM200"])).toBe("EMP1066");
  });
});

test("codigoDaFormulaParaLinha bate com a fórmula da planilha", () => {
  expect(codigoDaFormulaParaLinha(1064)).toBe("EMP1063");
  expect(codigoDaFormulaParaLinha(1067)).toBe("EMP1066");
});
