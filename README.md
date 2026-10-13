# iNPLAN Model uploader (application Windows)

Application Electron qui envoie dans InPlan les modèles STL et les lignes de découpe PTS
d'une arborescence `Nom_Prenom[_AAAA-MM-JJ]/Setup/fichiers`.

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
| `src/update-messages.js` | Textes des mises à jour (notes de version, erreurs) |
| `src/renderer/` | Interface (thème clair/sombre, journal coloré, paramètres) |

## Tests

```bash
npm test             # moteur d'upload, journal, messages de mise à jour
npm run test:smoke   # lance la vraie application Electron et vérifie la fenêtre
```

`npm test` fait tourner l'upload contre un faux serveur InPlan. Il vérifie notamment que l'app
envoie exactement les mêmes requêtes que la v0.1.0 sur une arborescence de référence, que les
lignes de découpe partent après tous les modèles, et les cas d'erreur (setup existant, homonymes,
jeton expiré, serveur injoignable…). Les deux commandes tournent sur GitHub à chaque push.

## Construire l'installeur

```bash
npm run dist
```

Produit `dist/iNPLAN-Model-uploader-<version>-Setup.exe`. Sous Linux, `npm run dist:linux`
produit un AppImage et un `.deb`. L'`appId` (`com.inplan.modeluploader`)
et le nom du package (`inplan-model-uploader`) doivent rester identiques : ils permettent de mettre
à jour l'application déjà installée chez les clients et de conserver leur configuration.

## Publier une mise à jour

1. Augmenter `version` dans `package.json` (ex. `0.2.1` → `0.2.2`).
2. Ajouter une section `## 0.2.2` en haut de `CHANGELOG.md` : c'est le texte affiché aux
   utilisateurs dans la fenêtre de mise à jour (sinon les messages des commits sont repris).
3. Pousser sur `main`.

Le workflow GitHub Actions (`.github/workflows/release.yml`) lance les tests puis, si cette version
n'a pas encore de release, construit l'installeur et publie la release `v<version>` avec
l'installeur, `latest.yml` et le `.blockmap`. Si un test échoue, rien n'est publié. Un push sur `main`
sans changement de version ne publie rien.

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
