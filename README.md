# Claude Scheduler

Aplicacao local para agendar execucoes do Claude Code em horarios definidos, usando o Windows Task Scheduler.

## Objetivo

O Claude tem um limite de utilizacao por janelas de 5 horas. Este projeto existe para aproveitar melhor esse limite: em vez de gastar tokens durante horas em que estas a trabalhar, podes preparar prompts e marcar uma hora especifica para o Claude executar tarefas automaticamente, por exemplo de madrugada ou noutro periodo em que nao estas a usar a ferramenta.

Assim, o trabalho automatico acontece num bloco de 5 horas que nao te faz diferenca, deixando mais margem de utilizacao para os horarios em que estas realmente a trabalhar.

## O que faz

- Permite criar varias tarefas com nome, projeto, horario, dias da semana e prompt.
- Regista cada tarefa no Windows Task Scheduler.
- Gera um ficheiro `.bat` por tarefa para executar o Claude Code no projeto escolhido.
- Guarda os prompts por tarefa.
- Executa em duas fases:
  - fase 1: o Claude analisa o projeto e escreve `.automation/ANALYSIS.md` e `.automation/PLAN.md`;
  - fase 2: o Claude executa o plano, valida o resultado e escreve `.automation/LAST_RUN.md`.
- Mostra uma agenda e um calendario das proximas execucoes.
- Permite correr uma tarefa manualmente para teste.
- Guarda logs em `logs/`.

## Requisitos

- Windows.
- Node.js instalado.
- Claude Code CLI instalado e autenticado.
- `claude` disponivel no `PATH` ou em `%USERPROFILE%\.local\bin\claude.exe`.
- Permissao para criar tarefas no Windows Task Scheduler.

## Instalar

```powershell
npm install
```

## Arrancar

```powershell
npm start
```

Depois abre:

```text
http://127.0.0.1:3000
```

Tambem podes usar:

```powershell
.\launcher.bat
```

Para criar o atalho no Ambiente de Trabalho:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

## Como usar

1. Abre a aplicacao.
2. Define um nome para a tarefa.
3. Escolhe o caminho do projeto onde o Claude deve trabalhar.
4. Define a hora de execucao, por exemplo `05:00`.
5. Escolhe os dias em que a tarefa deve correr.
6. Escreve o prompt ou usa o prompt por defeito.
7. Clica em `Save Task`.

Ao guardar, a aplicacao cria ou atualiza a tarefa correspondente no Windows Task Scheduler. Se a tarefa estiver ativa, o Windows passa a executa-la automaticamente no horario definido.

## Testar uma tarefa

Seleciona uma tarefa guardada e clica em `Test Run`. A aplicacao abre uma nova janela de terminal e executa o mesmo `.bat` que sera usado pelo agendamento.

## Logs

Os logs ficam em:

```text
logs/
```

Cada execucao cria um ficheiro com o identificador da tarefa e timestamp, por exemplo:

```text
claude-auto-<task-id>_2026-05-07_05-00.log
```

Tambem podes clicar em `Logs` na interface para abrir a pasta diretamente.

## Ficheiros principais

- `app.js`: servidor Express e API local.
- `index.html`: interface web.
- `lib.js`: validacao, prompt por defeito e geracao dos scripts.
- `tasks.json`: lista de tarefas configuradas.
- `prompt-<task-id>.txt`: prompt usado por uma tarefa.
- `run-claude-<task-id>.bat`: runner gerado para uma tarefa.
- `logs/`: historico das execucoes.
- `launcher.bat`: arranca o servidor e abre o browser.
- `setup.ps1`: cria o atalho no Ambiente de Trabalho.

## Acordar o PC automaticamente

Por defeito, as tarefas so correm se o computador estiver ligado e acordado. Com as configuracoes abaixo, o Windows consegue acordar o PC automaticamente a partir do sleep para executar uma tarefa.

> Nao funciona com o PC completamente desligado. Para isso, a unica opcao e configurar o BIOS (ver em baixo).

### Sleep → acordar automaticamente

**Passo 1 — Ativar wake timers no Windows**

1. Prime `Win + R`, escreve `powercfg.cpl` e prime Enter.
2. Clica em **Alterar definicoes do esquema** no plano de energia ativo.
3. Clica em **Alterar definicoes de energia avancadas**.
4. Expande **Suspensao → Permitir temporizadores de reativacao**.
5. Muda o valor para **Ativar**.
   - Em portatil, faz isto tanto em **Com bateria** como em **Ligado a corrente**.
6. Clica em OK.

**Passo 2 — Re-fazer o Deploy das tarefas**

Abre a aplicacao e clica em **Deploy** em cada tarefa existente. Isto re-regista a tarefa no Task Scheduler com a opcao de acordar o PC ativada.

### PC desligado → ligar automaticamente (BIOS)

Se o PC estiver completamente desligado, o Windows nao consegue ligar a maquina. A unica forma de o fazer e configurar um alarme no BIOS/UEFI:

1. Reinicia o computador e entra no BIOS/UEFI (normalmente com `Del`, `F2` ou `F10` durante o arranque; depende do fabricante).
2. Procura uma opcao chamada **RTC Wake**, **Power On By RTC Alarm**, **Resume By Alarm**, ou semelhante (normalmente em Power Management ou Advanced).
3. Ativa a opcao e define a hora a que o PC deve ligar.
4. Guarda e sai.

Nem todos os computadores suportam esta funcao. Consulta o manual da tua motherboard se nao encontrares a opcao.

## Testes

```powershell
npm test
```

## Notas

Este projeto nao aumenta nem contorna o rate limit do Claude. Ele apenas agenda trabalho para horas em que a utilizacao do teu limite e menos importante para ti.

Antes de agendares uma tarefa num projeto importante, faz primeiro um `Test Run` e confirma os logs.
