#!/bin/bash

# Configurações
ARQUIVO="$(cd "$(dirname "$0")/.." && pwd)/.env"
VARIAVEL="PUBLIC_BASE_URL"
EMAIL_DESTINO="paborgess@gmail.com"

get_value() {
    grep "^${VARIAVEL}=" "$ARQUIVO" | cut -d'=' -f2-
}

if [ ! -f "$ARQUIVO" ]; then
    echo "Erro: arquivo $ARQUIVO não encontrado." >&2
    exit 1
fi

if ! command -v inotifywait &>/dev/null; then
    echo "Erro: inotify-tools não instalado. Execute: sudo apt install inotify-tools" >&2
    exit 1
fi

VALOR_ANTIGO=$(get_value)

echo "[$(date)] Monitorando $VARIAVEL em $ARQUIVO"
echo "[$(date)] Valor atual: $VALOR_ANTIGO"

send_email() {
    local assunto="$1"
    local corpo="$2"

    if command -v mail &>/dev/null; then
        echo -e "$corpo" | mail -s "$assunto" "$EMAIL_DESTINO"
    elif command -v sendmail &>/dev/null; then
        printf "Subject: %s\n\n%b" "$assunto" "$corpo" | sendmail "$EMAIL_DESTINO"
    else
        echo "[$(date)] AVISO: nenhum agente de e-mail disponível (mail/sendmail). Instale mailutils." >&2
        return 1
    fi
}

while inotifywait -e modify "$ARQUIVO" 2>/dev/null; do
    VALOR_NOVO=$(get_value)

    if [ "$VALOR_ANTIGO" != "$VALOR_NOVO" ]; then
        ASSUNTO="Alerta: PUBLIC_BASE_URL alterada no servidor"
        CORPO="O parâmetro $VARIAVEL no arquivo $ARQUIVO foi modificado.\n\nAnterior: $VALOR_ANTIGO\nNovo:      $VALOR_NOVO\nData:      $(date)"

        if send_email "$ASSUNTO" "$CORPO"; then
            echo "[$(date)] Alteração detectada — e-mail enviado para $EMAIL_DESTINO."
        else
            echo "[$(date)] Alteração detectada — $VARIAVEL: '$VALOR_ANTIGO' → '$VALOR_NOVO'"
        fi

        VALOR_ANTIGO=$VALOR_NOVO
    fi
done
