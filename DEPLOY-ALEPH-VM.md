# Deploy na Aleph.im — Guia de Configuração

Documento técnico do processo de publicação da aplicação **Predictions With Sats** em uma VM
Aleph.im com domínio customizado (`pwsats.com`).

---

## Arquitetura da Aleph.im (entendendo as limitações)

A Aleph.im utiliza uma camada de hipervisor entre a internet pública e a VM:

```
Internet
    │
    ▼
37.114.37.140:80  ← IP público do HOST (nó Aleph.im)
    │
    ▼
aleph-vm supervisor  ← intercepta todo HTTP na porta 80
    │
    ▼ (somente se roteado via hash do programa)
172.16.7.2  ← IP interno da VM (IPv4 privado)
```

**Consequência:** apontar um domínio para o IP IPv4 público (`37.114.37.140`) resulta em:

```json
{"error": "404: Invalid message reference"}
```

O supervisor `aleph-vm` não sabe para qual VM encaminhar a requisição pois não há mapeamento
de domínio configurado.

**Solução:** A VM também recebe um **IPv6 público diretamente** na sua interface `ens3`,
sem intermediação do hipervisor. O tráfego IPv6 chega direto ao nginx.

```
Internet (cliente com IPv6)
    │
    ▼
2a0e:97c0:3e3:274:3:95a7:288f:92e1:80  ← IPv6 direto da VM
    │
    ▼
nginx dentro da VM  ← responde normalmente
```

---

## Dados desta instância

| Recurso | Valor |
|---|---|
| IP público IPv4 (HOST) | `37.114.37.140` |
| IP interno IPv4 (VM) | `172.16.7.2` |
| **IPv6 público (VM — usar no DNS)** | `2a0e:97c0:3e3:274:3:95a7:288f:92e1` |
| Interface de rede | `ens3` |
| Porta SSH externa | `24003` → `22` interno |
| Porta API | `3001` (local) |
| Serviço systemd | `pwsats-api` |

---

## Passo a passo para nova instância

### 1. SSH na VM

```bash
ssh root@37.114.37.140 -p 24003
# Ou via Tor/onion se configurado
```

### 2. Clonar o repositório

```bash
cd /root
git clone <URL-DO-REPOSITORIO> Predictions-With-Sats
cd Predictions-With-Sats
```

O `.env` já vem versionado no repositório. Se precisar customizar:

```bash
nano .env  # ajuste portas, tokens, etc.
```

> **Importante:** `.env` e `db/dump.sql` estão versionados no repositório (não estão no .gitignore).
> O dump do banco é gerado automaticamente a cada commit via git hook.

### 3. Instalar e fazer o build

```bash
bash scripts/install-clean.sh
# ou
sudo bash scripts/install-production.sh
```

Os scripts já incluem `listen [::]:80;` no nginx (corrigido neste commit).

### 4. Restaurar o banco de dados

O dump completo do banco (`db/dump.sql`) é versionado no repositório e atualizado
automaticamente a cada commit. Para restaurar:

```bash
PGPASSWORD=p4borge55 psql -h localhost -U pwsats -d pwsats_db < db/dump.sql
```

Ou criar o schema do zero com Drizzle:

```bash
cd artifacts/api-server
DATABASE_URL=postgresql://pwsats:p4borge55@localhost:5432/pwsats_db npx drizzle-kit push
```

Depois restaure os dados a partir do dump para manter bets, usuários e config.

### 5. Configurar git hook de auto-push (opcional)

```bash
# O hook já vem no repositório. Ativar:
cp hooks/post-commit .git/hooks/post-commit
chmod +x .git/hooks/post-commit
```

Com o hook ativo, cada commit gera um dump do banco, inclui no commit e faz push automático.

### 6. Verificar o IPv6 da VM

```bash
ip addr show ens3 | grep "inet6.*global"
# Exemplo de saída:
#   inet6 2a0e:97c0:3e3:274:3:95a7:288f:92e1/124 scope global
```

Anote o endereço IPv6 — será usado no DNS.

### 7. Confirmar que o nginx está ouvindo em IPv6

```bash
ss -tlnp | grep ':80'
# Deve mostrar:
#   LISTEN   0.0.0.0:80   (IPv4)
#   LISTEN   [::]:80      (IPv6)
```

Teste local via IPv6:

```bash
curl -6 http://[SEU-IPV6]/ | head -5
# Deve retornar o HTML da aplicação
```

### 8. Configurar o DNS

No painel do seu provedor DNS, adicione **dois registros**:

| Tipo | Nome | Valor | TTL |
|------|------|-------|-----|
| `AAAA` | `pwsats.com` | `2a0e:97c0:3e3:274:3:95a7:288f:92e1` | 300 |
| `AAAA` | `www.pwsats.com` | `2a0e:97c0:3e3:274:3:95a7:288f:92e1` | 300 |

> **Atenção:** O registro `A` (IPv4) para `37.114.37.140` **não funciona** para acesso web
> direto nesta infraestrutura. Mantenha o `A` apenas se precisar para SSH/outros usos.
> Clientes modernos preferem IPv6 (algoritmo Happy Eyeballs), então a maioria dos
> navegadores usará o registro `AAAA` automaticamente.

### 9. Aguardar propagação do DNS e testar

```bash
# Verificar se o DNS AAAA propagou:
dig AAAA pwsats.com

# Testar acesso via domínio com IPv6 forçado:
curl -6 -H "Host: pwsats.com" http://[2a0e:97c0:3e3:274:3:95a7:288f:92e1]/
```

---

## Diagnóstico rápido

```bash
# Status dos serviços
systemctl status nginx pwsats-api

# Logs da API
journalctl -u pwsats-api -f --no-pager -n 50

# Logs do nginx
tail -f /var/log/nginx/access.log /var/log/nginx/error.log

# Testar API localmente
curl http://localhost/api/healthz

# Testar frontend local
curl -sv http://localhost/ 2>&1 | head -20

# Verificar portas abertas
ss -tlnp | grep -E ':80|:443|:3001'
```

---

## Configuração atual do nginx

Arquivo: `/etc/nginx/sites-enabled/pwsats`

Pontos críticos:
- `listen [::]:80;` — **obrigatório** para que o IPv6 funcione
- `root` aponta para `artifacts/predictions-with-sats-web/dist/public`
- `location /api/` faz proxy reverso para `127.0.0.1:3001`
- `location /` usa `try_files` para servir a SPA

---

## HTTPS / Certbot (próximo passo recomendado)

Após confirmar que o domínio responde via IPv6, instalar o certificado TLS:

```bash
apt install certbot python3-certbot-nginx -y
certbot --nginx -d pwsats.com -d www.pwsats.com
```

O certbot precisa que `pwsats.com` resolva para o IPv6 desta VM (o registro AAAA).
O desafio HTTP-01 funcionará via IPv6.

Após o certificado, o certbot adiciona automaticamente o bloco `server` na porta 443 e
redireciona HTTP→HTTPS.

---

## Problema raiz — diagnóstico detalhado

### Sintoma
```
curl http://pwsats.com/
{"error": "404: Invalid message reference"}
```

### Causa
- `pwsats.com` resolvia para `37.114.37.140` (IPv4 do HOST Aleph.im)
- O serviço `aleph-vm/1.11.3` no host intercepta a porta 80
- O nginx da VM (rodando em `172.16.7.2:80`) nunca recebe a requisição

### Verificação
```bash
curl -sv http://pwsats.com/ 2>&1 | grep "< server:"
# Retornava: < server: aleph-vm/1.11.3  ← NÃO é o nginx da VM
```

### Solução aplicada
1. Adicionado `listen [::]:80;` no nginx (`/etc/nginx/sites-available/pwsats`)
2. Nginx recarregado: `systemctl reload nginx`
3. Scripts `install-clean.sh` e `install-production.sh` atualizados para incluir o mesmo
4. DNS AAAA a ser configurado pelo usuário apontando para o IPv6 da VM

### Verificação pós-correção
```bash
curl -6 http://[2a0e:97c0:3e3:274:3:95a7:288f:92e1]/
# Retorna: HTML da aplicação com "Server: nginx/1.24.0 (Ubuntu)"
```

