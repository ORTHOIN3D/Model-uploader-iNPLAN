# iNPLAN Model uploader (application Windows)

Application Electron qui envoie dans InPlan les modèles STL et les lignes de découpe PTS
d'une arborescence `Nom_Prenom[_AAAA-MM-JJ]/Setup/fichiers`. C'est la version graphique du
script `Tools/model_uploader` du dépôt InPlan.

## Développement

```bash
npm install
npm start
```

En développement, l'application utilise `%APPDATA%\inplan-model-uploader-dev` (config et logs)
pour ne pas toucher à l'application installée, et les mises à jour automatiques sont désactivées.
Si `npm start` indique qu'Electron n'est pas installé : `node node_modules/electron/install.js`.

| Fichier | Rôle |
|---|---|
| `src/main.js` | Fenêtre, configuration (mot de passe chiffré avec `safeStorage`), IPC, export des logs |
| `src/uploader.js` | Parcours des dossiers et appels à l'API InPlan : patients, setups et modèles d'abord, puis les lignes de découpe une fois tous les modèles envoyés (délai initial, puis nouveaux essais tant que le serveur traite les modèles) |
| `src/logger.js` | Journal : fichier quotidien dans `logs/` (14 jours) + envoi à la console de la fenêtre |
| `src/updater.js` | Mises à jour obligatoires depuis les releases GitHub (`electron-updater`) |
| `src/renderer/` | Interface (thème clair/sombre, journal coloré, paramètres) |

## Construire l'installeur

```bash
npm run dist
```

Produit `dist/iNPLAN-Model-uploader-<version>-Setup.exe`. Sous Linux, `npm run dist:linux`
produit un AppImage et un `.deb`. L'`appId` (`com.inplan.modeluploader`)
et le nom du package (`inplan-model-uploader`) doivent rester identiques : ils permettent de mettre
à jour l'application déjà installée chez les clients et de conserver leur configuration.

## Publier une mise à jour

1. Augmenter `version` dans `package.json` (ex. `0.2.0` → `0.2.1`).
2. Construire et envoyer sur GitHub avec un token qui peut écrire sur le dépôt :
   ```powershell
   $env:GH_TOKEN = "<token GitHub>"
   npm run release
   ```
   electron-builder crée une release **brouillon** `v<version>` sur `ORTHOIN3D/Model-uploader-iNPLAN`
   avec l'installeur, `latest.yml` et le `.blockmap`.
3. Sur GitHub, compléter les notes de version (affichées aux utilisateurs) puis **publier** la release.

Les applications installées vérifient les releases au démarrage puis toutes les 4 heures. Quand une
version plus récente est publiée, elles la téléchargent et bloquent l'utilisation jusqu'à son
installation (sauf pendant un upload en cours, qui n'est jamais interrompu).

Les clients n'ont pas de token GitHub : ce dépôt doit rester **public**, sinon l'application reçoit
une erreur 404 en cherchant les mises à jour. Ne jamais y commiter de mot de passe ni de token.

La v0.1.0 ne contient pas de système de mise à jour : la v0.2.0 doit être installée une fois à la main.

## Support

Paramètres > « Télécharger le fichier de logs » enregistre un fichier texte (version, système,
serveur, utilisateur, journal des 14 derniers jours, sans mot de passe) que le client envoie à
support@orthoin3d.com.
