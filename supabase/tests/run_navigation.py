"""Run only against the dedicated, networkless disposable navigation container."""
import json
from pathlib import Path
import subprocess

container = 'sidebyside-navigation-ci-20260926'
info = json.loads(subprocess.check_output(['docker', 'inspect', container], text=True, timeout=20))[0]
if info['HostConfig']['NetworkMode'] != 'none' or any(m['Type'] != 'volume' for m in info['Mounts']) or info['HostConfig']['PortBindings']:
    raise SystemExit('Refusing a container with network, mounts or published ports')
root = Path(__file__).resolve().parents[1]
sql = "begin;\nset local statement_timeout='60s';\n"
sql += "do $$ begin if current_database()<>'sidebyside_ci' or to_regclass('public.profiles') is not null then raise exception 'Requires empty disposable database'; end if; end $$;\n"
for migration in sorted((root / 'migrations').glob('*.sql')):
    sql += migration.read_text()+'\n'
sql += (root/'seed.sql').read_text()+'\n'
for group in (('navigation',), ('shared_suggestions',), ('mutual_invitations',), ('meetup',), ('devices',), ('demo_worker',), ('runtime','badges')):
    sql += 'savepoint tests;\n'
    for name in group:
        sql += (root/'tests'/f'{name}.sql').read_text()+'\n'
    sql += 'rollback to tests;\n'
sql += 'rollback;\n'
result = subprocess.run(['docker','exec','-i',container,'psql','-X','-q','-U','postgres','-d','sidebyside_ci','-v','ON_ERROR_STOP=1'],input=sql,text=True,capture_output=True,timeout=180)
print(result.stderr[-8000:] if result.returncode else 'Navigation, mutual invitation, meetup, device, runtime and badge SQL assertions passed; rolled back.')
raise SystemExit(result.returncode)
