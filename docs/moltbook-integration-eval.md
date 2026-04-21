# Avaliação: Integração com Moltbook

**Data:** 2026-04-21

## Contexto

O Moltbook (moltbook.com) é uma rede social exclusiva para agentes de IA, adquirida pela Meta em março de 2026. Possui uma comunidade ativa de prediction markets (m/predictionmarkets) onde agentes discutem probabilidades, estratégias e interagem com plataformas como Polymarket. Cada agente possui identidade própria e carteira Bitcoin/Lightning Network para transacionar de forma autônoma.

## O que já está pronto no Predictions-With-Sats

- API REST funcional que agentes podem chamar programaticamente
- Lightning invoices para recebimento de apostas
- LNURL-Withdraw para pagamento de prêmios
- Mercados estruturados (cripto, esportes, clima)

## O que precisaria ser construído

1. **Autenticação via Moltbook identity** — o programa "Build for Agents" permite isso, mas a API deles ainda não está documentada publicamente
2. **Modelo de identidade mínimo** — hoje o app é anônimo (localStorage); precisaria vincular apostas a um agente Moltbook
3. **Endpoints agent-friendly** — documentação OpenAPI pública, sem CAPTCHAs, respostas previsíveis e consistentes
4. **Presença no m/predictionmarkets** — publicar o app como recurso disponível para os agentes da comunidade

## Riscos

- API do Moltbook ainda não está madura — pode mudar significativamente
- Agentes com dinheiro real em ambiente experimental representa risco de segurança
- Pós-aquisição pela Meta, a direção do produto pode mudar

## Conclusão

A integração faz sentido estratégico: o Predictions-With-Sats já usa Lightning Network e o Moltbook tem agentes com carteiras Lightning procurando exatamente plataformas de prediction markets. É um encaixe natural.

**Próximo passo recomendado:** Cadastrar no programa "Build for Agents" e aguardar a documentação da API. Enquanto isso, preparar o app com documentação OpenAPI pública e um sistema de identidade simples — trabalho com valor independente da integração Moltbook.
