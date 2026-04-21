Baixar e ativar o tor expert bundle:
C:\Users\paborges\Downloads\tor-expert-bundle-windows-x86_64-15.0.10.tar\tor-expert-bundle-windows-x86_64-15.0.10\tor

Mobixterm
Remote host: IP Aleph Cloud
Username: root
Port: 24006

Apontar para a private key

Network settings
Proxy type: Socks5
Host: 127.0.0.1
Login: root
Port: 9050

Passo a Passo na sua VPS (Acesso inicial)
Conecte-se normalmente (usando a porta da Aleph):

Bash
ssh root@37.114.37.140 -p 24003
Instale o Tor:

Bash
apt update && apt install tor -y
Configure o Hidden Service:
Edite o arquivo torrc:

Bash
vim /etc/tor/torrc
Adicione estas linhas ao final do arquivo:

Plaintext
HiddenServiceDir /var/lib/tor/ssh_service/
HiddenServicePort 22 127.0.0.1:22
Nota: Aqui você usa a porta 22, pois o Tor está dentro da máquina e fala diretamente com o serviço local, ignorando o redirecionamento externo de portas da Aleph.

Reinicie o Tor e obtenha seu endereço único:

Bash
systemctl restart tor
cat /var/lib/tor/ssh_service/hostname
O comando acima vai te devolver algo como: xyz123abc...onion. Guarde esse endereço.

Passo a Passo na sua Máquina Local (Acesso Anônimo)
Agora que sua VPS está "escutando" na rede Onion, você não precisa mais usar o IP 37.114.37.140 nem a porta 24003.

No seu arquivo ~/.ssh/config (Linux/Mac) ou no terminal com suporte a ProxyCommand:

Plaintext
Host meu-app-hidden
    HostName SEU_ENDERECO_GERADO.onion
    User root
    Port 22
    # Certifique-se que o Tor (ou Tor Browser) está aberto na sua máquina local
    ProxyCommand nc -X 5 -x 127.0.0.1:9050 %h %p

Por que isso é melhor para o seu caso?
Ocultação Total do IP: Quando você usa ssh root@37.114.37.140 -p 24003, a Aleph Cloud (e qualquer nó no caminho) sabe que o seu IP real está acessando aquela instância.

Bypassing do Gateway: Ao usar o endereço .onion, a conexão nasce dentro da VPS e encontra você na rede Tor. O IP 37.114.37.140 torna-se irrelevante para o SSH.

Segurança contra Varreduras: Ninguém conseguirá "escanear" sua porta SSH na rede Tor, ao contrário do IP público da Aleph, que sofre tentativas de ataque constantes.

Dica Final: Após testar e confirmar que o acesso .onion funciona, você pode até remover a regra de port forwarding (imagem 2) no painel da Aleph Cloud. Assim, a porta SSH fica completamente fechada para a internet clara, respondendo apenas via rede Tor.



Sim, prejudica significativamente se você não tomar cuidado. O problema não é o ato de baixar o código em si, mas os **rastros digitais** que o GitHub (Microsoft) e a rede deixam durante esse processo.

Aqui estão os três pontos onde o seu anonimato está sendo comprometido nesse fluxo atual:

---

### 1. O GitHub sabe o IP da sua VPS
Sempre que você faz um `git pull` ou `git push` a partir da VPS, os servidores do GitHub registram o endereço IP de origem.
* **O risco:** Se o seu GitHub (`p4b0rge5`) está vinculado ao seu e-mail real ou foi acessado por você sem VPN, o GitHub agora tem uma ligação direta: **Sua Identidade Real <-> Sua Conta GitHub <-> O IP da sua VPS Aleph.**
* **Consequência:** Se o anonimato é contra governos ou grandes corporações, eles podem intimar o GitHub para saber quem acessou aquele IP naquele horário.

### 2. O Vazamento do Token (Security Warning)
Na imagem anterior, você enviou o comando `git push` com o token exposto na URL. 
* **O risco:** Além de ficar no histórico do servidor (`.bash_history`), esse token é enviado via HTTPS, mas o GitHub registra que o token "X" foi usado pelo IP "Y".
* **Consequência:** Se esse token for o mesmo que você usa no seu PC pessoal, você criou um vínculo técnico (fingerprint) entre as duas máquinas.

### 3. Tráfego de Rede (Metadata)
O provedor da VPS (Aleph) e os roteadores de trânsito conseguem ver que sua máquina está conversando constantemente com os servidores do GitHub (`github.com`).
* **O risco:** Embora o conteúdo seja criptografado, o destino não é. Isso prova que aquela VPS específica é usada para desenvolvimento de software por alguém que tem acesso ao repositório **Predictions-With-Sats**.

---

### Como resolver e manter o anonimato "Bulletproof"?

Para corrigir isso e manter seu projeto **Predictions-With-Sats** verdadeiramente anônimo:

1.  **Use o Tor para o Git na VPS:**
    Você pode configurar o Git para usar o serviço Tor que você já instalou na VPS.
    ```bash
    # Configura o git para usar o proxy do Tor (SOCKS5)
    git config --global http.proxy 'socks5h://127.0.0.1:9050'
    ```
    *Desta forma, o GitHub verá um IP de um nó de saída do Tor, e não o IP da Aleph.*

2.  **Use SSH em vez de HTTPS para o Git:**
    Em vez de usar tokens na URL (HTTPS), crie uma chave SSH **exclusiva** para a VPS, adicione-a ao seu GitHub e clone via SSH (`git@github.com:...`). É mais seguro e não deixa o token exposto no histórico de comandos.

3.  **Considere o Codeberg ou Self-Hosted:**
    Se o anonimato for crítico, o GitHub é um alvo fácil. O **Codeberg.org** é uma alternativa alemã sem fins lucrativos e muito mais amigável à privacidade. Ou, melhor ainda, você pode rodar um servidor de Git simples (como o **Gitea**) na sua própria infraestrutura anônima.



**Resumo:** O fato de você baixar o repositório não "quebra" o app, mas cria uma trilha de migalhas de pão que liga você à VPS. Configurar o **git proxy via Tor** é o passo que falta para fechar essa brecha.