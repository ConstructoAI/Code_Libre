# Manuel utilisateur — Module Administration

> **ERP Constructo** — Logiciel de gestion intégré pour entreprises de construction au Québec
> **Version du manuel** : 1.0
> **Date** : 2026-04-25
> **Public** : administrateurs (gestion utilisateurs, paramètres entreprise, abonnement, sécurité)

---

## Table des matières

1. [Vue d'ensemble et accès](#1-vue-densemble-et-acces)
2. [Interface — Configuration et utilisateurs](#2-interface--configuration-et-utilisateurs)
3. [Workflows pas-à-pas](#3-workflows-pas-a-pas)
4. [Référence — Rôles, paramètres et limites](#4-reference--roles-parametres-et-limites)
5. [Intégrations, cas particuliers et FAQ](#5-integrations-cas-particuliers-et-faq)

---

## 1. Vue d'ensemble et accès

### 1.1 À quoi sert le module Administration

Le module **Administration** est réservé aux **administrateurs** de votre entreprise (tenant). Il permet de :

- **Gérer les utilisateurs** (création, suppression, rôles, mots de passe)
- **Configurer l'entreprise** (logo, raison sociale, RBQ, NEQ, TPS/TVQ, adresse)
- **Paramétrer les modules** (devis par défaut, conditions, marges, taxes, séquences numérotation)
- **Gérer l'abonnement** (plan, facturation Stripe, crédits IA)
- **Configurer la sécurité** (politique mot de passe, 2FA, sessions)
- **Sauvegardes & Exports** (backup base, export complet)
- **Logs et audit** (historique connexions, actions sensibles)

### 1.2 Concepts-clés

| Concept | Description |
|---|---|
| **Tenant** | Votre entreprise (espace isolé multi-tenant) |
| **Utilisateur** | Compte individuel avec login + mot de passe |
| **Rôle** | Niveau d'accès (Administrateur / Utilisateur / Lecture seule) |
| **Plan** | Abonnement (Starter / Pro / Business / Enterprise) |
| **Crédits IA** | Solde pour utilisation Assistant IA |
| **Schema PostgreSQL** | Espace technique isolé pour vos données |
| **2FA** | Authentification à deux facteurs (TOTP) |

### 1.3 Accès

- **Sidebar** → **Administration** (icône engrenage, visible uniquement pour les administrateurs)
- **URL** : `/admin`
- Sous-pages : `/admin/users`, `/admin/config`, `/admin/billing`, `/admin/security`, `/admin/logs`

### 1.4 Permissions

- **Réservé strictement aux administrateurs** du tenant
- Les autres utilisateurs ne voient pas l'icône Administration dans le menu
- Le **propriétaire du compte** (créateur) a tous les droits par défaut

---

## 2. Interface — Configuration et utilisateurs

### 2.1 Page Administration (`/admin`)

Layout principal :
```
+--------------------------------------------------------------+
| ADMINISTRATION                                                |
+--------------------------------------------------------------+
| [Tableau de bord] [Utilisateurs] [Configuration]             |
| [Abonnement & Facturation] [Sécurité] [Logs]                |
+--------------------------------------------------------------+
| Vue actuelle (selon onglet)                                  |
+--------------------------------------------------------------+
```

### 2.2 Tableau de bord Admin

KPI cards :
- Utilisateurs actifs
- Plan actuel + Date renouvellement
- Crédits IA restants
- Espace stockage utilisé / disponible
- Dernière sauvegarde

Liste des dernières actions sensibles (créations utilisateurs, modifications mots de passe, etc.).

### 2.3 Onglet Utilisateurs

Liste : Nom, Email, Rôle, Date création, Dernière connexion, Statut (Actif/Suspendu).

#### Modale Créer un utilisateur

| Champ | Détail |
|---|---|
| Nom complet * | Prénom + Nom |
| Email * | Identifiant unique (ne pourra pas être changé) |
| Mot de passe initial | Généré ou défini manuellement |
| Rôle * | Administrateur / Utilisateur / Lecture seule |
| Activer immédiatement | Booléen (défaut true) |
| Envoyer email de bienvenue | Booléen (avec mot de passe ou lien activation) |

#### Détail utilisateur

- Infos profil (nom, email, photo)
- Rôle + Permissions par module (à venir)
- Dernière connexion + IP
- Sessions actives (avec bouton Déconnecter)
- Bouton Réinitialiser mot de passe
- Bouton Suspendre / Réactiver
- Bouton Supprimer (avec confirmation)

### 2.4 Onglet Configuration

Sous-sections :

#### Entreprise
- Logo (upload)
- Raison sociale
- Adresse complète
- Téléphone, Email, Site web
- Numéro RBQ
- Numéro NEQ
- Numéro TPS
- Numéro TVQ
- Conditions de paiement par défaut

#### Modules
- **Devis** : conditions par défaut, exclusions par défaut, marges (Admin %, Conting. %, Profit %)
- **Factures** : taux TPS, taux TVQ (figés mais affichables), modèle email
- **Bons de Commande** : conditions standard, modèle email
- **Bons de Travail** : statuts personnalisés (à venir)
- **Numérotation** : séquences (PROJ-, DEV-, BT-, BC-, FACT-)
- **Email** : SMTP host, port, user, mot de passe, expéditeur

#### Personnalisation
- Couleurs (à venir)
- Polices (à venir)
- Devise (CAD figé pour QC)
- Format de date

### 2.5 Onglet Abonnement & Facturation

#### Plan actuel
- Nom du plan (Starter / Pro / Business / Enterprise)
- Date de renouvellement
- Prix mensuel / annuel
- Bouton **Changer de plan**

#### Stripe (intégration paiement)
- Méthode de paiement actuelle (carte, prélèvement)
- Bouton Mettre à jour
- Historique des factures Constructo
- Téléchargement factures PDF

#### Crédits IA
- Solde actuel
- Quota mensuel inclus dans le plan
- Crédits supplémentaires achetés
- Bouton **Acheter des crédits**

### 2.6 Onglet Sécurité

#### Politique de mots de passe
- Longueur minimum
- Caractères requis (majuscule, minuscule, chiffre, spécial)
- Expiration (jours)
- Réutilisation interdite (n derniers mots de passe)

#### Authentification à deux facteurs (2FA)
- Activation par utilisateur
- TOTP (Google Authenticator, Authy)
- Codes de récupération

#### Sessions
- Durée maximum d'inactivité
- Connexions simultanées max
- IP autorisées (whitelist)

### 2.7 Onglet Logs

Journal d'audit :
- Connexions/déconnexions
- Création/modification/suppression d'entités sensibles
- Modifications de mots de passe
- Actions administratives

Filtres : par utilisateur, par date, par type d'action.

### 2.8 Vue mobile

Onglets dans menu accordéon. Modales adaptées tactile.

---

## 3. Workflows pas-à-pas

### 3.1 Créer un nouvel utilisateur
1. `/admin` → onglet **Utilisateurs** → bouton **« + Nouvel utilisateur »**
2. Saisir Nom complet et Email
3. Choisir Rôle (Administrateur / Utilisateur / Lecture seule)
4. Définir mot de passe initial (ou laisser le système générer)
5. Cocher **« Envoyer email de bienvenue »**
6. Cliquer **« Créer »**
7. L'utilisateur reçoit un email avec ses identifiants

### 3.2 Modifier un utilisateur
1. Cliquer sur l'utilisateur dans la liste
2. Bouton crayon → modifier (rôle, statut)
3. Cliquer **« Enregistrer »**

### 3.3 Réinitialiser le mot de passe d'un utilisateur
1. Détail utilisateur → bouton **« Réinitialiser mot de passe »**
2. Choisir : générer aléatoire OU saisir manuellement
3. Envoyer par email à l'utilisateur
4. L'utilisateur sera obligé de le changer à la première connexion

### 3.4 Suspendre un utilisateur
1. Détail → bouton **« Suspendre »**
2. L'utilisateur ne peut plus se connecter
3. Ses données restent accessibles (lecture par les autres)
4. Bouton **« Réactiver »** pour rétablir l'accès

### 3.5 Supprimer un utilisateur
1. Détail → bouton poubelle → confirmer
2. **Important** : préférer la suspension à la suppression (intégrité historique)
3. Si suppression : ses entrées (notes, commentaires) restent mais avec auteur « Utilisateur supprimé »

### 3.6 Mettre à jour les infos de l'entreprise
1. Onglet **Configuration** → section **Entreprise**
2. Modifier Logo, Adresse, Téléphone, etc.
3. Renseigner RBQ, NEQ, TPS, TVQ (apparaîtra sur tous les documents générés)
4. Cliquer **« Enregistrer »**

### 3.7 Modifier les conditions de devis par défaut
1. Configuration → **Modules** → **Devis**
2. Modifier les textes Conditions / Exclusions
3. Cliquer **« Enregistrer »**
4. Les nouveaux devis hériteront de ces valeurs

### 3.8 Modifier les marges par défaut
1. Configuration → **Modules** → **Devis** → section Marges
2. Saisir nouveaux pourcentages (Admin / Conting. / Profit)
3. Personnaliser libellés si besoin
4. Cliquer **« Enregistrer »**

### 3.9 Configurer le serveur SMTP pour l'envoi d'emails
1. Configuration → **Email**
2. Saisir SMTP host (ex: smtp.gmail.com), Port (587 ou 465)
3. User, Mot de passe (utiliser un mot de passe d'application si Gmail/Outlook)
4. Adresse expéditeur
5. Bouton **« Tester l'envoi »**
6. Si OK, **« Enregistrer »**

### 3.10 Activer la 2FA pour un utilisateur
1. Onglet **Sécurité** → section **2FA**
2. Cliquer **« Activer pour tous les utilisateurs »** OU
3. Détail utilisateur → cocher **« Exiger 2FA »**
4. À la prochaine connexion, l'utilisateur configure son authenticator (Google Authenticator, Authy)

### 3.11 Définir une politique de mots de passe stricte
1. Onglet **Sécurité** → **Politique mots de passe**
2. Longueur minimum (recommandé 12)
3. Cocher Majuscule + Minuscule + Chiffre + Caractère spécial
4. Expiration (90 jours par exemple)
5. Cliquer **« Enregistrer »**
6. Tous les utilisateurs devront changer leur mot de passe à leur prochaine connexion

### 3.12 Changer de plan d'abonnement
1. Onglet **Abonnement** → bouton **« Changer de plan »**
2. Comparer les plans (Starter / Pro / Business / Enterprise)
3. Choisir nouveau plan
4. Confirmer (paiement Stripe automatique au prorata)
5. Le plan s'active immédiatement

### 3.13 Acheter des crédits IA supplémentaires
1. Onglet **Abonnement** → section **Crédits IA**
2. Bouton **« Acheter »**
3. Choisir montant (ex: 10 000 crédits = 49 $)
4. Paiement Stripe
5. Crédits ajoutés au solde immédiatement

### 3.14 Mettre à jour la méthode de paiement
1. Abonnement → section **Stripe**
2. Bouton **« Mettre à jour »**
3. Saisir nouvelle carte (formulaire Stripe sécurisé)
4. Cliquer **« Enregistrer »**

### 3.15 Télécharger les factures Constructo
1. Abonnement → liste des factures Constructo
2. Cliquer icône téléchargement → PDF

### 3.16 Consulter les logs d'audit
1. Onglet **Logs**
2. Filtrer par utilisateur, type d'action, date
3. Recherche libre

### 3.17 Forcer la déconnexion d'une session
1. Détail utilisateur → liste des sessions actives
2. Cliquer icône **« Déconnecter »** sur la session
3. La session est immédiatement invalidée

### 3.18 Configurer les séquences de numérotation
1. Configuration → **Numérotation**
2. Modifier le préfixe ou format (PROJ-, DEV-, BT-, BC-, FACT-)
3. Réinitialiser le compteur (annuel par défaut)
4. **Attention** : ne pas modifier en cours d'année (risque doublons)

### 3.19 Sauvegarder la base de données
1. Onglet **Sauvegardes** (à venir)
2. Bouton **« Lancer une sauvegarde »**
3. Téléchargement du fichier SQL chiffré

### 3.20 Exporter toutes les données du tenant
1. Onglet **Exports** → **« Export complet »**
2. Format : ZIP avec CSV par module + fichiers attachments
3. Téléchargement (peut prendre plusieurs minutes selon volume)

### 3.21 Désactiver un module pour le tenant
**À venir** : possibilité de cacher certains modules selon le besoin (ex: pas d'Immobilier pour un sous-traitant).

### 3.22 Personnaliser les couleurs et polices
**À venir** : interface de thème personnalisable.

---

## 4. Référence — Rôles, paramètres et limites

### 4.1 Rôles utilisateur (3)

| Rôle | Permissions |
|---|---|
| **Administrateur** | Accès complet. Gestion utilisateurs, configuration, abonnement, sécurité |
| **Utilisateur** | CRUD sur tous les modules métier (Projets, CRM, Devis, etc.) sans accès Admin |
| **Lecture seule** | Consultation uniquement, aucune modification (à venir) |

### 4.2 Plans d'abonnement

| Plan | Utilisateurs | Crédits IA/mois | Stockage | Prix/mois |
|---|---|---|---|---|
| Starter | 3 | 10 000 | 5 Go | 49 $ |
| Pro | 10 | 50 000 | 50 Go | 149 $ |
| Business | 25 | 200 000 | 200 Go | 349 $ |
| Enterprise | Illimité | Illimité | Illimité | Sur devis |

> Prix indicatifs. Voir grille tarifaire à jour sur le site Constructo.

### 4.3 Paramètres entreprise

| Champ | Format | Exemple |
|---|---|---|
| Raison sociale | Texte | Constructo Construction Inc. |
| Adresse complète | Texte | 123 Rue Principale |
| Ville | Texte | Montréal |
| Province | Liste | Québec |
| Code postal | A1A 1A1 | H2X 1Y4 |
| Téléphone | Format libre | (514) 555-1234 |
| Email | Email | info@constructo.ca |
| Site web | URL | https://constructo.ca |
| Numéro RBQ | NNNN-NNNN-NN | 1234-5678-90 |
| Numéro NEQ | XXXXXXXXXX | 1234567890 |
| Numéro TPS | XXXXXXXXX-RT-NNNN | 123456789RT0001 |
| Numéro TVQ | XXXXXXXXXX TQ NNNN | 1234567890TQ0001 |

### 4.4 Marges par défaut (Devis)

| Marge | Défaut | Plage permise |
|---|---|---|
| Administration | 3 % | 0-50 % |
| Contingences | 12 % | 0-50 % |
| Profit | 15 % | 0-100 % |

### 4.5 Politique mots de passe (recommandée)

| Critère | Recommandé |
|---|---|
| Longueur minimum | 12 caractères |
| Majuscule | Requise |
| Minuscule | Requise |
| Chiffre | Requis |
| Caractère spécial | Requis (!@#$...) |
| Expiration | 90 jours |
| Réutilisation | Interdite (dernières 5) |

### 4.6 Sessions

| Paramètre | Défaut |
|---|---|
| Durée inactivité max | 60 minutes |
| Connexions simultanées | 3 par utilisateur |
| Token JWT validité | 8 heures |

### 4.7 Format des numéros (séquences configurables)

| Module | Format |
|---|---|
| Projet | PROJ-AAAA-NNNNN |
| Opportunité | OPP-NNNNN |
| Devis | DEV-AAAA-NNN |
| Bon de Travail | BT-NNNNN |
| Bon de Commande | BC-AAAA-NNNNN |
| Facture Vente | FACT-AAAA-NNNNN |
| Facture Achat | ACHAT-AAAA-NNNNN |
| Dossier | DOS-AAAA-NNNNN |
| Inspection | INS-AAAA-NNN |
| Mouvement stock | MOV-AAAA-NNNNN |

### 4.8 Limites système (par tenant)

| Élément | Limite |
|---|---|
| Utilisateurs | Selon plan |
| Stockage attachments | Selon plan |
| API calls | 10 000/jour (à confirmer) |
| Backups conservés | 30 jours |
| Logs conservés | 90 jours |
| Sessions concurrentes | 3 / utilisateur |

### 4.9 Endpoints administration

| Endpoint | Description |
|---|---|
| GET /admin/users | Lister utilisateurs |
| POST /admin/users | Créer utilisateur |
| PUT /admin/users/{id} | Modifier utilisateur |
| DELETE /admin/users/{id} | Supprimer utilisateur |
| GET /admin/config | Configuration tenant |
| PUT /admin/config | Mettre à jour config |
| GET /admin/billing | Infos abonnement Stripe |
| GET /admin/logs | Journal d'audit |

---

## 5. Intégrations, cas particuliers et FAQ

### 5.1 Intégrations avec les autres modules

L'administration influe sur **tous les modules** :

| Module | Influence administration |
|---|---|
| **Devis** | Conditions/exclusions/marges par défaut |
| **Factures** | Numéros TPS/TVQ entreprise sur les documents |
| **BC** | Conditions standard, infos entreprise |
| **Tous documents HTML** | Logo, raison sociale, RBQ, NEQ |
| **Email** | Configuration SMTP |
| **IA** | Crédits + quota |
| **Tous modules** | Permissions par rôle, sessions, sécurité |

### 5.2 Cas particuliers

- **Plus d'administrateur** : impossible (le créateur du tenant ne peut pas être supprimé)
- **Email d'utilisateur changé** : impossible directement, créer nouveau compte et désactiver l'ancien
- **Mot de passe oublié** : utiliser le lien « Mot de passe oublié » à la connexion (envoie email)
- **2FA perdu** : utiliser un code de récupération. Si tous les codes utilisés, contacter le support
- **Tenant désactivé** : contacter Constructo. Pas d'auto-suspension
- **Limite stockage atteinte** : passer au plan supérieur. Pas de suppression auto
- **Modification numéro RBQ en cours d'année** : aucun impact sur les documents existants

### 5.3 Astuces

- **Préférer suspension à suppression** : préserve l'historique et les références
- **Configurer l'entreprise dès le début** : RBQ, NEQ, TPS, TVQ apparaîtront sur tous les documents
- **2FA pour tous les admins** : critique pour la sécurité
- **Politique mots de passe stricte** : protège contre les attaques
- **Sauvegarde mensuelle** : télécharger une sauvegarde complète une fois par mois (sécurité)
- **Logs mensuel** : auditer régulièrement les actions sensibles
- **Crédits IA** : surveiller le quota mensuel pour anticiper les rechargements

### 5.4 FAQ

**Q : Combien d'administrateurs maximum ?**
R : Pas de limite. Recommandé : 2 administrateurs minimum (continuité), 3-5 maximum (contrôle).

**Q : Puis-je transférer mon compte propriétaire à un autre utilisateur ?**
R : Pas dans cette version. Contacter le support Constructo.

**Q : Que se passe-t-il si je dépasse mon quota IA mensuel ?**
R : Les fonctions IA sont bloquées jusqu'au début du mois suivant OU acheter des crédits supplémentaires.

**Q : Comment migrer depuis un autre ERP vers Constructo ?**
R : Pas d'import natif universel. Contacter Constructo pour un service d'import sur mesure.

**Q : Mes données sont-elles chiffrées ?**
R : Oui, en transit (TLS 1.3) et au repos (AES-256). Sauvegardes chiffrées également.

**Q : Où sont hébergées les données ?**
R : Au Canada (Render.com région CA) pour conformité Loi 25 (Québec) et résidence des données.

**Q : Puis-je récupérer mes données si je quitte Constructo ?**
R : Oui, via Export complet (ZIP avec CSV + attachments). Disponible dans Administration.

**Q : Le module supporte-t-il SSO (Single Sign-On) ?**
R : Pas dans cette version. À venir avec Enterprise.

**Q : Comment désactiver un utilisateur en congé prolongé ?**
R : Suspendre (et non supprimer). Réactiver à son retour.

**Q : Puis-je créer des rôles personnalisés ?**
R : Pas dans cette version. 3 rôles fixes : Administrateur, Utilisateur, Lecture seule.

**Q : Les modifications de configuration sont-elles immédiates ?**
R : Oui, propagation instantanée à tous les utilisateurs (rafraîchissement de page peut être nécessaire).

**Q : Comment annuler mon abonnement ?**
R : Onglet Abonnement → bouton « Annuler le plan ». Préserve l'accès jusqu'à la fin de la période payée.

**Q : Puis-je tester un autre plan avant de m'engager ?**
R : Oui, période d'essai 14 jours sur Pro et Business. Pas d'engagement.

### 5.5 Limites connues

- Pas de rôles personnalisables (3 rôles fixes)
- Pas de SSO (à venir Enterprise)
- Pas de transfert propriétaire intégré
- Pas d'import universel depuis autres ERP
- Sauvegardes manuelles (à venir : automatiques quotidiennes)
- Pas de désactivation de modules par tenant (à venir)
- Personnalisation visuelle limitée (logo OK, couleurs/polices à venir)
- Pas de provisioning automatique d'utilisateurs (SCIM)
- Logs conservés 90 jours seulement (politique fixe)
- Pas de gestion fine de permissions par module/champ

---

> **Important** : conservez toujours **au moins 2 administrateurs actifs** pour assurer la continuité en cas d'indisponibilité de l'un d'eux.

---

> **Besoin d'aide supplémentaire ?** Contactez le support Constructo : info@constructoai.ca

---

*Manuel généré pour ERP Constructo — Module Administration — v1.0 — 2026-04-25*
