const mod = await import(process.cwd() + '/scripts/checks/' + process.argv[2] + '.check.ts');
for (const r of mod.runChecks()) console.log(JSON.stringify(r));
