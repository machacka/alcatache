# 🔒 Alcatâche — le pénitencier domestique

- **Gardien** (parent, Android) : APK `Alcatache-Gardien.apk`, publié dans *Releases → latest*.
- **Détenue** (enfant, iPhone) : appli web publiée sur GitHub Pages, ajoutée à l'écran d'accueil.
- **Firebase** (gratuit) : base Firestore + envoi des alertes (Cloud Messaging).

## Mise en service

1. **GitHub → Settings → Pages → Source : « GitHub Actions »**.
2. **Firebase → Firestore → Règles** : coller le contenu de `firestore.rules`, puis Publier.
3. **Téléphone du Gardien** : télécharger l'APK depuis *Releases*, l'installer (autoriser « sources inconnues »).
   Ouvrir → « Construire la prison » → Réglages → importer la clé de service (.json).
4. **iPhone** : ouvrir l'adresse GitHub Pages dans **Safari** → Partager → *Sur l'écran d'accueil*.
   Ouvrir l'icône → saisir le code de la prison → *Activer les alertes*.
5. Réglages Gardien → **Tester une alerte**.

## Fonctionnement

- Écrouer = choisir des tâches (dans l'ordre) + un motif → alerte immédiate, puis relance toutes les 60 s.
- La détenue déclare chaque tâche (photo obligatoire pour certaines) ; le Gardien valide ou refuse.
- Dernière tâche validée → libération automatique, calcul des points :
  +10/tâche, +20 si tout est fait en moins de 15 min, −1/min après 20 min, −5 par refus (réglable).
- Points → pécule (100 pts = 1 €), paie demandable une fois par mois à partir du 25.
- Blocage du téléphone : bouton **Kids 360** ; sonnerie forcée : bouton **Faire sonner** (Localiser d'Apple).
