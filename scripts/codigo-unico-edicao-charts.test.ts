import { describe, expect, test } from "bun:test";
import {
  analisarFormulaBD,
  codigoDaFormulaParaLinha,
  linhaDoCodigoDaFormula,
} from "../backend/src/services/codigoUnicoEdicaoCharts";

describe("analisarFormulaBD", () => {
  test("ARRAYFORMULA aberta (B2:B)", () => {
    const e = analisarFormulaBD([
      "Código único",
      '=ARRAYFORMULA(IF(B2:B=""; ""; "EMP" & TEXT(ROW(B2:B)-1; "000")))',
    ]);
    expect(e.tipo).toBe("arrayformula-aberta");
  });

  test("ARRAYFORMULA limitada", () => {
    const e = analisarFormulaBD(["", '=ARRAYFORMULA(IF($B$2:$B$1064="";"";"x"))']);
    expect(e).toMatchObject({ tipo: "arrayformula-limitada", ultimaLinha: 1064 });
  });

  test("sem ARRAYFORMULA", () => {
    expect(analisarFormulaBD(["Código único", "EMP001"]).tipo).toBe("sem-arrayformula");
  });
});

describe("código da fórmula", () => {
  test("linha -> código bate com a planilha", () => {
    expect(codigoDaFormulaParaLinha(1064)).toBe("EMP1063");
    expect(codigoDaFormulaParaLinha(1067)).toBe("EMP1066");
    expect(codigoDaFormulaParaLinha(5)).toBe("EMP004");
  });

  test("código -> linha", () => {
    expect(linhaDoCodigoDaFormula("EMP1065")).toBe(1066);
    expect(linhaDoCodigoDaFormula("emp004")).toBe(5);
    expect(linhaDoCodigoDaFormula("EMPALBM001")).toBeNull();
    expect(linhaDoCodigoDaFormula("")).toBeNull();
  });
});
