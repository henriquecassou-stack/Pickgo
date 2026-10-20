// Publica o site (modo demonstração) no GitHub Pages: gera o build com a
// pasta /Pickgo/ e envia a pasta dist para o branch gh-pages.
// Uso: npm run publicar
import { execSync } from 'node:child_process'
import { copyFileSync, writeFileSync } from 'node:fs'

const rodar = (cmd, cwd) => execSync(cmd, { stdio: 'inherit', cwd, env: { ...process.env, BASE_PATH: '/Pickgo/' } })
const remoto = execSync('git remote get-url origin').toString().trim()

rodar('npm run build')
// o GitHub Pages devolve 404.html para links diretos (ex.: /Pickgo/admin): o app assume a rota
copyFileSync('dist/index.html', 'dist/404.html')
writeFileSync('dist/.nojekyll', '')

rodar('git init -q -b gh-pages', 'dist')
rodar('git add -A', 'dist')
rodar('git -c user.name="pickgo" -c user.email="pickgo@users.noreply.github.com" commit -q -m "Publicar site"', 'dist')
rodar(`git push -f ${remoto} gh-pages`, 'dist')
console.log('\nPublicado. O GitHub leva cerca de 1 minuto para atualizar o site.')
