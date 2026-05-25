# Como colocar o Caixinha Reembolso online

Tempo estimado: 30–40 minutos na primeira vez.

---

## 1. Neon (PostgreSQL gratuito)

1. Acesse https://neon.tech e crie uma conta (pode usar o Google)
2. Clique em **New Project** → dê um nome (ex: `caixinha`)
3. Após criar, clique em **SQL Editor**
4. Cole todo o conteúdo do arquivo `schema.sql` e execute (botão Run)
5. Vá em **Dashboard → Connection string** e copie a URL completa
   - Formato: `postgres://user:password@host.neon.tech/dbname?sslmode=require`
   - Guarde essa URL, você vai precisar dela no Render

---

## 2. Cloudflare R2 (storage de imagens gratuito)

1. Acesse https://dash.cloudflare.com e crie uma conta (gratuito)
2. No menu lateral, clique em **R2**
3. Clique em **Create bucket** → nome: `caixinha-uploads`
4. Após criar o bucket:
   - Clique em **Settings** dentro do bucket
   - Em **Public Access**, clique em **Allow Access** e confirme
   - Copie a **Public bucket URL** (formato: `https://pub-xxx.r2.dev`)
5. Volte para R2 (menu principal) → clique em **Manage R2 API Tokens**
6. Clique em **Create API Token**
   - Permissions: **Object Read & Write**
   - Specify bucket: selecione `caixinha-uploads`
   - Clique em **Create API Token**
7. Copie e guarde:
   - **Access Key ID**
   - **Secret Access Key**
   - **Endpoint** (formato: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`)

---

## 3. GitHub

1. Crie um repositório novo em https://github.com/new
   - Nome: `caixinha-reembolso`
   - Privado (recomendado)
2. Dentro da pasta do projeto no seu computador:

```bash
git init
git add .
git commit -m "primeiro commit"
git remote add origin https://github.com/SEU_USUARIO/caixinha-reembolso.git
git push -u origin main
```

**Atenção:** certifique-se de que `.env` está no `.gitignore` (já está).

---

## 4. Render (hospedagem Node.js gratuita)

1. Acesse https://render.com e crie uma conta (pode usar o GitHub)
2. Clique em **New → Web Service**
3. Conecte seu repositório GitHub (`caixinha-reembolso`)
4. Configure:
   - **Name:** `caixinha-reembolso`
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
5. Role até **Environment Variables** e adicione:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | URL copiada do Neon |
| `R2_ENDPOINT` | Endpoint do R2 |
| `R2_ACCESS_KEY_ID` | Access Key ID do R2 |
| `R2_SECRET_ACCESS_KEY` | Secret Access Key do R2 |
| `R2_BUCKET_NAME` | `caixinha-uploads` |
| `R2_PUBLIC_URL` | URL pública do bucket R2 |

6. Clique em **Create Web Service**
7. Aguarde o deploy (2–5 minutos)
8. Render vai gerar uma URL pública tipo `https://caixinha-reembolso.onrender.com`

---

## 5. Verificar

Acesse a URL do Render e faça login:
- `admin` / `admin123`
- `colaborador` / `123456`

---

## Observações importantes

### Free tier do Render dorme após inatividade
O serviço gratuito do Render "hiberna" após 15 minutos sem acesso.
O primeiro acesso após isso demora ~30 segundos para acordar.
Para evitar isso, pode usar https://cron-job.org para fazer um ping a cada 10 minutos (gratuito).

### Trocar senhas
Os usuários iniciais têm senhas padrão. Para trocar, você vai precisar gerar
novos hashes. Futuramente pode ser adicionada uma tela de troca de senha no app.

### Banco de dados
O Neon gratuito tem 512 MB de storage e fica ativo indefinidamente.
Não tem limite de tempo como outros free tiers.
