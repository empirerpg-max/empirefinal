#!/usr/bin/env bash
# Roda cada arquivo de teste num processo próprio: alguns testes usam
# mock.module, que no bun vale para o processo inteiro e contaminaria os
# outros arquivos se todos rodassem juntos.
set -u
falhas=0
for f in "$@"; do
  if bun test "$f" > /tmp/bun-teste-saida.txt 2>&1; then
    echo "OK   $f $(grep -E '^ *[0-9]+ pass' /tmp/bun-teste-saida.txt | tr -s ' ')"
  else
    echo "FAIL $f"; tail -30 /tmp/bun-teste-saida.txt; falhas=$((falhas+1))
  fi
done
exit $falhas
