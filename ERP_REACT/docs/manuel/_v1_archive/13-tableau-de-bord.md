# Manuel utilisateur — Module Tableau de bord & Statistiques

> **ERP Constructo** — Logiciel de gestion intégré pour entreprises de construction au Québec
> **Version du manuel** : 1.0
> **Date** : 2026-04-25
> **Public** : utilisateurs finaux (gestionnaires, dirigeants, comptables)

---

## Table des matières

1. [Vue d'ensemble et accès](#1-vue-densemble-et-acces)
2. [Interface — Dashboard et Analytics](#2-interface--dashboard-et-analytics)
3. [Workflows pas-à-pas](#3-workflows-pas-a-pas)
4. [Référence — KPIs et calculs](#4-reference--kpis-et-calculs)
5. [Intégrations, cas particuliers et FAQ](#5-integrations-cas-particuliers-et-faq)

---

## 1. Vue d'ensemble et accès

### 1.1 À quoi sert le Tableau de bord

Le **Tableau de bord** est votre **vue d'ensemble** de l'activité de votre entreprise. Il consolide en temps réel les indicateurs clés de performance (KPIs) :

- **Activité commerciale** : opportunités, devis en cours, taux de conversion
- **Production** : projets actifs, BT en cours, avancement
- **Finances** : revenus du mois, factures en attente, marges
- **RH** : heures travaillées, employés actifs, productivité
- **Inventaire** : valeur stock, mouvements, alertes
- **Tendances** : graphiques évolution sur 12 mois

Le module **Analytics** (statistiques avancées) propose des analyses approfondies par module.

### 1.2 Concepts-clés

| Concept | Description |
|---|---|
| **KPI** | Indicateur clé de performance (chiffre actualisé en temps réel) |
| **Période** | Plage temporelle (Mois en cours, Trimestre, Année, Personnalisée) |
| **Carte (Card)** | Bloc d'affichage d'un KPI |
| **Graphique** | Visualisation (barres, ligne, donut) |
| **Filtre** | Restriction (par projet, employé, statut) |
| **Export** | Téléchargement données (CSV, PDF) |

### 1.3 Accès

- **Sidebar** → **Tableau de bord** (icône grille)
- **URL** : `/dashboard` ou `/`
- **Module Analytics** : `/analytics` pour analyses approfondies

### 1.4 Permissions

- **Tous les utilisateurs authentifiés** peuvent consulter
- Certains KPIs financiers réservés aux **administrateurs/comptables**

---

## 2. Interface — Dashboard et Analytics

### 2.1 Page Tableau de bord (`/dashboard`)

Layout :
```
+-------------------------------------------------------------+
| Bonjour [User]   [Période v]   [Filtre projet v]  [Refresh]|
+-------------------------------------------------------------+
| KPIs PRINCIPAUX (4 cartes)                                  |
| +-----------+-----------+-----------+-----------+           |
| | Revenus   | Marge %   | Projets   | Heures    |           |
| | 245 000$  | 32 %      | 12 actifs | 1 240h    |           |
| +-----------+-----------+-----------+-----------+           |
+-------------------------------------------------------------+
| GRAPHIQUES (4-6 visuels)                                    |
| - Revenus par mois (barres 12 mois)                         |
| - Pipeline CRM (donut par statut)                           |
| - Avancement projets (barres horizontales)                  |
| - Top 5 clients par CA                                      |
+-------------------------------------------------------------+
| LISTES RAPIDES                                              |
| - Devis envoyés en attente (top 10)                         |
| - Factures impayées (top 10)                                |
| - BT en cours (top 10)                                      |
| - Activités du jour (calendrier)                            |
+-------------------------------------------------------------+
```

### 2.2 Sélecteur de période

Choix : **Aujourd'hui**, **Cette semaine**, **Ce mois**, **Ce trimestre**, **Cette année**, **Personnalisée**.

Personnalisée → choisir Date début et Date fin.

### 2.3 KPIs principaux (cartes)

#### Activité commerciale
- **Nouveaux clients** : count de companies créées dans la période
- **Opportunités créées** : count
- **Devis envoyés** : count
- **Taux de conversion** : (gagnés / total clôturés) × 100

#### Production
- **Projets actifs** : count statut En cours
- **BT en cours** : count
- **Heures pointées** : Σ time_entries

#### Finances
- **Revenus** : Σ factures de la période
- **À recouvrer** : Σ soldes dus (Vente)
- **Dépenses** : Σ factures Achat + heures × taux
- **Marge** (%) : (Revenus - Dépenses) / Revenus × 100

#### RH
- **Employés actifs** : count
- **Heures totales** : Σ time_entries validées

### 2.4 Graphiques

Bibliothèque utilisée : **Recharts** ou similaire.

#### Revenus par mois (barres)
12 derniers mois, axe Y en $ CAD.

#### Pipeline CRM (donut)
Répartition des opportunités par statut (PROSPECTION, QUALIFICATION, etc.).

#### Avancement projets (barres horizontales)
Top 10 projets actifs avec barre de progression %.

#### Top 5 clients (CA)
Liste avec nom + CA total cumulé.

#### Top 10 fournisseurs (Achats)
Liste avec nom + montant total commandes.

### 2.5 Listes rapides

Tableaux compacts avec lien direct vers la fiche :
- **Devis envoyés en attente** : numéro, client, montant, date envoi
- **Factures impayées** : numéro, client, solde dû, jours de retard
- **BT en cours** : numéro, projet, statut, montant
- **Activités du jour** : type, sujet, heure (CRM)

### 2.6 Page Analytics (`/analytics`)

Analyses plus poussées avec onglets :
- **Ventes** : pipeline détaillé, conversion par source, taux par phase
- **Production** : progression projets, retard moyen, charge employés
- **Finances** : marge par projet, CA mensuel, BFR, trésorerie prévisionnelle
- **RH** : heures par employé/projet, productivité, coût main-d'œuvre
- **Inventaire** : rotation stock, top produits, valeur

### 2.7 Filtre par projet

Dropdown global pour filtrer tous les KPIs sur un projet spécifique.

### 2.8 Bouton Refresh

Recharge tous les KPIs depuis la base. Utile après modifications massives.

### 2.9 Vue mobile

Cards empilées, graphiques optimisés tactile, navigation par onglets en bas.

---

## 3. Workflows pas-à-pas

### 3.1 Consulter les KPIs du mois en cours
1. `/dashboard` → vue par défaut
2. KPIs principaux affichés en haut
3. Période = Ce mois (par défaut)
4. Lecture immédiate

### 3.2 Changer la période d'analyse
1. Dropdown période en haut
2. Choisir Aujourd'hui / Cette semaine / Ce trimestre / Cette année / Personnalisée
3. Tous les KPIs se rafraîchissent

### 3.3 Filtrer par projet
1. Dropdown filtre projet en haut
2. Sélectionner un projet (ou « Tous »)
3. Les KPIs et graphiques se restreignent au projet

### 3.4 Voir l'évolution sur 12 mois
Graphique « Revenus par mois » → barres mensuelles. Survol pour valeur exacte.

### 3.5 Identifier les factures en retard
Liste « Factures impayées » → trier par jours de retard. Cliquer pour ouvrir la facture.

### 3.6 Voir les devis en attente de réponse client
Liste « Devis envoyés en attente » → trier par date d'envoi pour relancer les plus anciens.

### 3.7 Suivre l'avancement des projets actifs
Graphique « Avancement projets » → barres de progression. Cliquer pour ouvrir le projet.

### 3.8 Identifier les clients les plus rentables
Graphique « Top 5 clients » → liste avec CA. Adapter votre stratégie commerciale.

### 3.9 Suivre la pipeline commerciale
Graphique « Pipeline CRM » → donut par statut. Identifier les goulots d'étranglement.

### 3.10 Analyser la productivité de l'équipe
Page Analytics → onglet RH → heures par employé/projet, taux de pointage validé.

### 3.11 Vérifier la marge par projet
Page Analytics → onglet Finances → marge par projet → identifier les projets sous-performants.

### 3.12 Suivre la trésorerie prévisionnelle
Page Analytics → onglet Finances → trésorerie prévisionnelle (factures + paiements attendus 90 jours).

### 3.13 Exporter les données du dashboard
1. Bouton **« Exporter »** (CSV ou PDF)
2. Choisir KPIs et graphiques à inclure
3. Téléchargement

### 3.14 Programmer un rapport hebdomadaire
**À venir** : envoi automatique du dashboard par email chaque lundi.

### 3.15 Personnaliser les KPIs affichés
**À venir** : sélectionner les cartes à afficher pour chaque utilisateur.

### 3.16 Voir un graphique en plein écran
Cliquer sur l'icône agrandissement → vue plein écran. ESC pour fermer.

### 3.17 Comparer deux périodes
**À venir** : afficher année courante vs année précédente.

### 3.18 Recevoir des alertes sur seuils
**À venir** : notification si KPI sort d'une plage (ex: marge < 15 %).

---

## 4. Référence — KPIs et calculs

### 4.1 KPIs Activité commerciale

| KPI | Formule |
|---|---|
| Nouveaux clients | count(companies WHERE created_at IN période) |
| Opportunités créées | count(opportunities WHERE created_at IN période) |
| Devis envoyés | count(devis WHERE statut='Envoyé' AND date_envoi IN période) |
| Devis acceptés | count(devis WHERE statut='Accepté' AND date_decision IN période) |
| Taux de conversion | (gagnés / total clôturés) × 100 |
| CA des opportunités gagnées | Σ montant_estime des opportunités GAGNÉ |

### 4.2 KPIs Production

| KPI | Formule |
|---|---|
| Projets actifs | count(projects WHERE statut='En cours') |
| BT en cours | count(formulaires type='BON_TRAVAIL' AND statut='EN_COURS') |
| BT terminés (période) | count(BT WHERE statut='TERMINE' AND date_fin IN période) |
| Heures pointées | Σ time_entries WHERE punch_in IN période |
| Avancement moyen | AVG(progression %) projets actifs |

### 4.3 KPIs Finances

| KPI | Formule |
|---|---|
| Revenus | Σ factures Vente WHERE date_emission IN période |
| Dépenses | Σ factures Achat + (heures × taux) IN période |
| Marge brute | Revenus − Dépenses |
| Marge % | (Marge / Revenus) × 100 |
| À recouvrer | Σ soldes dus (factures Vente non payées) |
| À payer | Σ soldes dus (factures Achat non payées) |
| Encaissé | Σ paiements reçus IN période |

### 4.4 KPIs RH

| KPI | Formule |
|---|---|
| Employés actifs | count(employees WHERE statut='Actif') |
| Heures totales | Σ time_entries.total_hours WHERE validated=true |
| Heures sup | Σ heures > 40h/semaine |
| Coût main-d'œuvre | Σ heures × taux horaire |
| Productivité | (heures pointées / heures théoriques) × 100 |

### 4.5 KPIs Inventaire

| KPI | Formule |
|---|---|
| Valeur stock | Σ (stock × PMP) produits actifs |
| Mouvements (période) | count(mouvements WHERE date IN période) |
| Stock bas | count(produits WHERE stock < seuil minimum) |
| Top produits sortie | TOP 10 par Σ quantité SORTIE |

### 4.6 Graphiques disponibles

| Type | Données | Usage |
|---|---|---|
| Barres verticales | Revenus par mois | Évolution annuelle |
| Donut | Pipeline CRM par statut | Répartition |
| Barres horizontales | Avancement projets | Comparaison |
| Ligne | Trésorerie prévisionnelle | Flux dans le temps |
| Tableau | Top clients/fournisseurs | Classement |
| Carte (compteur) | KPI unique | Snapshot |

### 4.7 Périodes prédéfinies

| Période | Plage |
|---|---|
| Aujourd'hui | Date courante uniquement |
| Cette semaine | Lundi → dimanche courants |
| Ce mois | 1er → dernier jour mois courant |
| Ce trimestre | Trimestre civil (Q1/Q2/Q3/Q4) |
| Cette année | 1er janvier → 31 décembre courant |
| Personnalisée | Dates choisies par l'utilisateur |

### 4.8 Limites système

| Élément | Limite |
|---|---|
| Refresh fréquence | Manuel (pas auto) |
| Top listes | 10 éléments |
| Graphiques | Données 12 mois max |
| Filtres simultanés | 1 (projet ou employé) |

### 4.9 Endpoints

| Endpoint | Description |
|---|---|
| GET /dashboard/summary | KPIs principaux |
| GET /dashboard/charts | Données graphiques |
| GET /analytics/sales | Analyse ventes |
| GET /analytics/production | Analyse production |
| GET /analytics/finances | Analyse finances |
| GET /analytics/hr | Analyse RH |

---

## 5. Intégrations, cas particuliers et FAQ

### 5.1 Sources de données du Dashboard

Le Dashboard agrège **tous les modules** :
- **Projets** : projets actifs, avancement
- **CRM** : opportunités, pipeline, top clients
- **Devis** : taux conversion, montant moyen
- **Factures** : revenus, encaissements, à recouvrer
- **Bons de Travail** : production en cours
- **Bons de Commande** : achats, dépenses fournisseurs
- **Pointage** : heures, productivité
- **Inventaire** : valeur stock, alertes
- **Comptabilité** : marges, trésorerie

### 5.2 Cas particuliers

- **Période vide** : si aucune activité dans la période choisie, KPIs = 0 ou « Aucune donnée »
- **Projet sans budget** : le calcul de marge utilise les revenus uniquement
- **Données en retard** : si le pointage n'est pas encore validé, les heures n'apparaissent pas (utiliser l'option « Inclure non validés » à venir)
- **Filtre + période combinés** : croisement strict (ex: « projet X sur ce mois »)
- **Multi-tenant** : les KPIs sont stricts au tenant courant

### 5.3 Astuces

- **Consulter chaque matin** : prendre 5 minutes pour scanner les KPIs et identifier les priorités
- **Période trimestrielle** : pour vue stratégique
- **Filtrer par projet** : pour réunion de chantier ou suivi client spécifique
- **Exporter pour réunion** : générer un PDF du dashboard pour partage hors-ligne
- **Onglet Analytics** : pour analyses approfondies, revues mensuelles

### 5.4 FAQ

**Q : Pourquoi mes revenus du mois sont à 0 ?**
R : Vérifier que les factures sont bien marquées « Envoyée » ou « Payée » et dans la bonne période.

**Q : Pourquoi le taux de conversion est-il bas ?**
R : Vérifier le ratio Devis acceptés / Devis envoyés. Si bas, analyser les raisons des refus dans le CRM.

**Q : La marge affichée correspond-elle à la marge nette ?**
R : Non, c'est la marge brute (Revenus − Coûts directs). La marge nette inclurait les frais administratifs, taxes, etc.

**Q : Puis-je personnaliser les KPIs affichés ?**
R : Pas dans cette version. Tous les utilisateurs voient les mêmes cartes.

**Q : Comment exporter le dashboard ?**
R : Bouton Exporter (PDF ou CSV) en haut.

**Q : Les données sont-elles en temps réel ?**
R : Oui, à chaque chargement de page. Cliquer Refresh pour forcer le rechargement.

**Q : Pourquoi mon dashboard est-il vide ?**
R : Probablement vous êtes administrateur sur un nouveau tenant sans données. Créer projets/devis/factures pour commencer à voir les KPIs.

**Q : Le dashboard est-il consultable par les employés simples ?**
R : Oui, mais certains KPIs financiers peuvent être masqués selon le rôle (à venir).

**Q : Comment comparer ce mois vs mois précédent ?**
R : Pas de comparaison directe dans cette version. Changer la période manuellement et noter les valeurs.

**Q : Puis-je créer mes propres graphiques ?**
R : Pas dans cette version (à venir avec un module BI personnalisable).

### 5.5 Limites connues

- Pas de personnalisation des KPIs par utilisateur
- Pas de comparaisons automatiques (vs période précédente, vs prévisions)
- Pas d'alertes sur seuils dépassés
- Pas d'envoi automatique par email
- Pas de drag-and-drop pour réorganiser les cartes
- Pas de widgets externes (intégration Power BI, Tableau)
- Refresh manuel uniquement (pas d'auto-refresh)
- Filtres limités (un seul à la fois)
- Pas d'export PDF formaté pour impression A4

---

> **Besoin d'aide supplémentaire ?** Contactez votre administrateur ou l'équipe support de Constructo.

---

*Manuel généré pour ERP Constructo — Module Tableau de bord & Statistiques — v1.0 — 2026-04-25*
