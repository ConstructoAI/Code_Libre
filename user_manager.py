"""
Module de gestion des utilisateurs pour l'interface Streamlit
À intégrer dans l'onglet Admin
Compatible Multi-Tenant
"""

import streamlit as st
import pandas as pd
from datetime import datetime
from typing import Optional
from security_utils import PasswordManager, PasswordValidator
from erp_database import ERPDatabase
import database_config
from database_config import validate_schema_name, set_search_path_secure
from ui_helpers import render_premium_table


def get_tenant_users_query_context():
    """
    Retourne le contexte pour les requêtes utilisateurs selon le mode (multi-tenant ou non).

    Returns:
        tuple: (connection, table_prefix, placeholder, db_type, schema)
    """
    schema = st.session_state.get('tenant_schema', None)
    db_type = database_config.get_database_type()
    ph = database_config.get_placeholder()
    conn = database_config.get_connection()

    if schema and schema != 'public':
        # Mode multi-tenant
        if db_type == 'postgresql':
            cursor = conn.cursor()
            # SÉCURITÉ: Utiliser set_search_path_secure pour éviter injection SQL
            set_search_path_secure(cursor, schema)
            table_prefix = ''
        else:
            table_prefix = f"{schema}_"
    else:
        # Mode normal (pas de tenant)
        table_prefix = ''

    return conn, table_prefix, ph, db_type, schema


def execute_tenant_query(query: str, params: tuple = None, fetch: bool = True):
    """
    Exécute une requête SQL sur la table users du tenant actuel.

    Args:
        query: Requête SQL avec {table} comme placeholder pour le nom de table
        params: Paramètres de la requête
        fetch: Si True, retourne les résultats

    Returns:
        Liste de dictionnaires ou None
    """
    conn, table_prefix, ph, db_type, schema = get_tenant_users_query_context()
    cursor = conn.cursor()

    # Remplacer {table} par le nom correct de la table
    table_name = f"{table_prefix}users"
    final_query = query.replace('{table}', table_name)

    # Remplacer les placeholders ? par %s pour PostgreSQL
    if db_type == 'postgresql':
        final_query = final_query.replace('?', '%s')

    try:
        if params:
            cursor.execute(final_query, params)
        else:
            cursor.execute(final_query)

        if fetch:
            rows = cursor.fetchall()
            if db_type == 'postgresql':
                # PostgreSQL retourne des RealDictRow
                results = [dict(row) for row in rows]
            else:
                # Autre base de données avec Row
                columns = [desc[0] for desc in cursor.description] if cursor.description else []
                results = [dict(zip(columns, row)) for row in rows]

            # Reset search_path pour PostgreSQL
            if db_type == 'postgresql' and schema and schema != 'public':
                cursor.execute('SET search_path TO public')

            conn.close()
            return results
        else:
            conn.commit()
            last_id = None  # PostgreSQL gère les IDs via RETURNING

            # Reset search_path pour PostgreSQL
            if db_type == 'postgresql' and schema and schema != 'public':
                cursor.execute('SET search_path TO public')

            conn.close()
            return last_id

    except Exception as e:
        conn.close()
        raise e

def show_user_management_page(db: ERPDatabase):
    """
    Page complète de gestion des utilisateurs

    Args:
        db: Instance ERPDatabase
    """

    st.title("👥 Gestion des Utilisateurs")

    # Tabs pour organiser les fonctionnalités
    tab1, tab2, tab3 = st.tabs([
        "📋 Liste des utilisateurs",
        "➕ Créer un utilisateur",
        "✏️ Modifier/Supprimer"
    ])

    # TAB 1: Liste des utilisateurs
    with tab1:
        show_users_list(db)

    # TAB 2: Créer un utilisateur
    with tab2:
        show_create_user_form(db)

    # TAB 3: Modifier/Supprimer
    with tab3:
        show_edit_delete_users(db)

def show_users_list(db: ERPDatabase):
    """Affiche la liste de tous les utilisateurs"""

    st.subheader("📋 Liste des Utilisateurs")

    try:
        # Récupérer tous les utilisateurs du tenant actuel
        # Essayer d'abord avec created_at (format tenant), sinon sans colonne de date
        try:
            users = execute_tenant_query("""
                SELECT
                    id,
                    username,
                    full_name,
                    email,
                    is_admin,
                    active,
                    created_at as date_created,
                    last_login
                FROM {table}
                ORDER BY is_admin DESC, username
            """)
        except Exception as e:
            # Fallback sans colonne de date
            users = execute_tenant_query("""
                SELECT
                    id,
                    username,
                    full_name,
                    email,
                    is_admin,
                    active,
                    NULL as date_created,
                    last_login
                FROM {table}
                ORDER BY is_admin DESC, username
            """)

        if not users:
            st.info("Aucun utilisateur trouvé. Créez-en un dans l'onglet '➕ Créer'.")
            return

        # Convertir en DataFrame pour affichage
        df = pd.DataFrame(users)

        # Mapper is_admin en rôle pour affichage
        df['role'] = df['is_admin'].apply(lambda x: '👑 Admin' if x else '👷 Employé')

        # Formater les colonnes
        df['active'] = df['active'].apply(lambda x: '✅ Actif' if x else '❌ Inactif')

        # Formater date_created seulement si elle n'est pas NULL
        if 'date_created' in df.columns and df['date_created'].notna().any():
            df['date_created'] = pd.to_datetime(df['date_created'], errors='coerce').dt.strftime('%Y-%m-%d %H:%M')
        else:
            df['date_created'] = 'N/A'

        # Renommer les colonnes
        df = df.rename(columns={
            'username': 'Nom d\'utilisateur',
            'full_name': 'Nom complet',
            'email': 'Email',
            'role': 'Rôle',
            'active': 'Statut',
            'date_created': 'Date création',
            'last_login': 'Dernière connexion'
        })

        # Afficher le dataframe (sans id et is_admin)
        display_columns = [col for col in df.columns if col not in ['id', 'is_admin']]
        render_premium_table(df[display_columns].to_dict('records'))

        # Statistiques
        col1, col2, col3, col4 = st.columns(4)

        with col1:
            st.metric("Total utilisateurs", len(users))

        with col2:
            active_count = sum(1 for u in users if u['active'])
            st.metric("Utilisateurs actifs", active_count)

        with col3:
            admin_count = sum(1 for u in users if u.get('is_admin'))
            st.metric("Administrateurs", admin_count)

        with col4:
            employee_count = sum(1 for u in users if not u.get('is_admin'))
            st.metric("Employés", employee_count)

    except Exception as e:
        st.error(f"❌ Erreur lors du chargement: {e}")

def show_create_user_form(db: ERPDatabase):
    """Formulaire de création d'utilisateur"""

    st.subheader("➕ Créer un Nouvel Utilisateur")

    with st.form("create_user_form", clear_on_submit=True):
        st.markdown("### Informations de base")

        col1, col2 = st.columns(2)

        with col1:
            username = st.text_input(
                "Nom d'utilisateur *",
                placeholder="ex: jdupont",
                help="Identifiant unique pour se connecter"
            )
            full_name = st.text_input(
                "Nom complet *",
                placeholder="ex: Jean Dupont"
            )
            email = st.text_input(
                "Email",
                placeholder="ex: jdupont@entreprise.ca",
                help="Optionnel, mais recommandé"
            )

        with col2:
            role = st.selectbox(
                "Rôle *",
                options=['admin', 'contremaitre', 'employee'],
                format_func=lambda x: {
                    'admin': '👑 Administrateur',
                    'contremaitre': '🔧 Contremaître',
                    'employee': '👷 Employé'
                }[x],
                help="Administrateur = accès complet, Contremaître = supervision équipe, Employé = accès limité"
            )

            active = st.checkbox("Utilisateur actif", value=True)

        st.markdown("### Mot de passe")

        col1, col2 = st.columns(2)

        with col1:
            password = st.text_input(
                "Mot de passe *",
                type="password",
                help=f"Minimum {PasswordValidator.MIN_LENGTH} caractères, avec majuscule, minuscule, chiffre et caractère spécial"
            )

        with col2:
            password_confirm = st.text_input(
                "Confirmer le mot de passe *",
                type="password"
            )

        # Bouton de soumission
        submitted = st.form_submit_button(
            "✅ Créer l'utilisateur",
            width="stretch",
            type="primary"
        )

        if submitted:
            # Validation
            errors = []

            if not username:
                errors.append("Le nom d'utilisateur est requis")

            if not full_name:
                errors.append("Le nom complet est requis")

            if not password:
                errors.append("Le mot de passe est requis")

            if password != password_confirm:
                errors.append("Les mots de passe ne correspondent pas")

            # Vérifier si l'utilisateur existe déjà
            if username:
                existing = execute_tenant_query(
                    "SELECT id FROM {table} WHERE username = ?",
                    (username,)
                )
                if existing:
                    errors.append(f"L'utilisateur '{username}' existe déjà")

            # Vérifier si l'email existe déjà
            if email:
                existing = execute_tenant_query(
                    "SELECT id FROM {table} WHERE email = ?",
                    (email,)
                )
                if existing:
                    errors.append(f"L'email '{email}' est déjà utilisé")

            # Valider le mot de passe
            if password:
                is_valid, message = PasswordValidator.validate_password(password)
                if not is_valid:
                    errors.append(f"Mot de passe invalide: {message}")

            # Afficher les erreurs
            if errors:
                for error in errors:
                    st.error(f"❌ {error}")
                return

            # Créer l'utilisateur dans le tenant
            try:
                # Hasher le mot de passe
                password_hash = PasswordManager.hash_password(password)

                # Convertir role en is_admin
                is_admin = (role == 'admin')

                # Insérer dans la table du tenant
                now = datetime.now().isoformat()
                execute_tenant_query("""
                    INSERT INTO {table} (
                        username, password_hash, full_name, email,
                        is_admin, active, created_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (
                    username,
                    password_hash,
                    full_name,
                    email if email else None,
                    is_admin,
                    active,
                    now
                ), fetch=False)

                st.success(f"✅ Utilisateur '{username}' créé avec succès!")
                st.balloons()

            except Exception as e:
                st.error(f"❌ Erreur lors de la création: {e}")

def show_edit_delete_users(db: ERPDatabase):
    """Interface pour modifier ou supprimer des utilisateurs"""

    st.subheader("✏️ Modifier ou Supprimer un Utilisateur")

    try:
        # Récupérer tous les utilisateurs du tenant
        users = execute_tenant_query("""
            SELECT id, username, full_name, is_admin
            FROM {table}
            ORDER BY username
        """)

        if not users:
            st.info("Aucun utilisateur trouvé")
            return

        # Sélectionner un utilisateur
        user_options = {
            f"{u['username']} ({u['full_name']})": u['id']
            for u in users
        }

        selected_user_label = st.selectbox(
            "Sélectionnez un utilisateur",
            options=list(user_options.keys())
        )

        if not selected_user_label:
            return

        user_id = user_options[selected_user_label]

        # Récupérer les détails complets
        user_details = execute_tenant_query("""
            SELECT id, username, full_name, email, is_admin, active
            FROM {table}
            WHERE id = ?
        """, (user_id,))

        if not user_details:
            st.error("Utilisateur introuvable")
            return

        user = user_details[0]

        # Tabs pour modifier ou supprimer
        tab1, tab2 = st.tabs(["✏️ Modifier", "🗑️ Supprimer"])

        with tab1:
            st.markdown("### Modifier les informations")

            with st.form("edit_user_form"):
                col1, col2 = st.columns(2)

                with col1:
                    new_full_name = st.text_input(
                        "Nom complet",
                        value=user['full_name'] or ''
                    )
                    new_email = st.text_input(
                        "Email",
                        value=user['email'] if user['email'] else ""
                    )

                with col2:
                    # Déterminer l'index actuel
                    role_options = ['admin', 'contremaitre', 'employee']
                    current_role_index = 0 if user.get('is_admin') else 2
                    new_role = st.selectbox(
                        "Rôle",
                        options=role_options,
                        index=current_role_index,
                        format_func=lambda x: {
                            'admin': '👑 Administrateur',
                            'contremaitre': '🔧 Contremaître',
                            'employee': '👷 Employé'
                        }[x]
                    )
                    new_active = st.checkbox(
                        "Utilisateur actif",
                        value=bool(user['active'])
                    )

                st.markdown("### Changer le mot de passe (optionnel)")
                new_password = st.text_input(
                    "Nouveau mot de passe",
                    type="password",
                    help="Laissez vide pour ne pas modifier"
                )

                if new_password:
                    new_password_confirm = st.text_input(
                        "Confirmer le nouveau mot de passe",
                        type="password"
                    )

                submitted = st.form_submit_button(
                    "💾 Enregistrer les modifications",
                    width="stretch"
                )

                if submitted:
                    try:
                        # Convertir role en is_admin
                        new_is_admin = (new_role == 'admin')

                        # Préparer la requête de mise à jour
                        if new_password:
                            # Valider le mot de passe
                            if new_password != new_password_confirm:
                                st.error("❌ Les mots de passe ne correspondent pas")
                                return

                            is_valid, message = PasswordValidator.validate_password(new_password)
                            if not is_valid:
                                st.error(f"❌ Mot de passe invalide: {message}")
                                return

                            # Hasher le nouveau mot de passe
                            password_hash = PasswordManager.hash_password(new_password)

                            execute_tenant_query("""
                                UPDATE {table}
                                SET full_name = ?, email = ?, is_admin = ?,
                                    active = ?, password_hash = ?
                                WHERE id = ?
                            """, (
                                new_full_name,
                                new_email if new_email else None,
                                new_is_admin,
                                new_active,
                                password_hash,
                                user_id
                            ), fetch=False)
                        else:
                            # Mise à jour sans changement de mot de passe
                            execute_tenant_query("""
                                UPDATE {table}
                                SET full_name = ?, email = ?, is_admin = ?,
                                    active = ?
                                WHERE id = ?
                            """, (
                                new_full_name,
                                new_email if new_email else None,
                                new_is_admin,
                                new_active,
                                user_id
                            ), fetch=False)

                        st.success(f"✅ Utilisateur '{user['username']}' modifié avec succès!")
                        st.rerun()

                    except Exception as e:
                        st.error(f"❌ Erreur lors de la modification: {e}")

        with tab2:
            st.markdown("### 🗑️ Supprimer cet utilisateur")

            role_display = '👑 Admin' if user.get('is_admin') else '👷 Employé'
            st.warning(f"""
            **Attention!** Vous êtes sur le point de supprimer l'utilisateur:
            - **Username:** {user['username']}
            - **Nom:** {user['full_name']}
            - **Rôle:** {role_display}

            Cette action est **irréversible**.
            """)

            confirm_delete = st.checkbox(
                "Je confirme vouloir supprimer cet utilisateur",
                key="confirm_delete"
            )

            if confirm_delete:
                if st.button("🗑️ SUPPRIMER DÉFINITIVEMENT", type="secondary"):
                    try:
                        execute_tenant_query(
                            "DELETE FROM {table} WHERE id = ?",
                            (user_id,),
                            fetch=False
                        )
                        st.success(f"✅ Utilisateur '{user['username']}' supprimé")
                        st.rerun()
                    except Exception as e:
                        st.error(f"❌ Erreur lors de la suppression: {e}")

    except Exception as e:
        st.error(f"❌ Erreur: {e}")

# Fonction pratique pour intégrer dans app.py
def integrate_in_admin_page(db: ERPDatabase):
    """
    Fonction à appeler dans l'onglet Admin de app.py

    Usage dans app.py:
        from user_manager import integrate_in_admin_page

        # Dans show_admin_page():
        integrate_in_admin_page(db)
    """
    show_user_management_page(db)
