# memory_manager.py
# Gestionnaire de mémoire pour l'Assistant IA - Memory Tool
# Permet à Claude de stocker et récupérer des informations entre les conversations

import os
import json
from pathlib import Path
from typing import Dict, Any, Optional, List
import logging

logger = logging.getLogger(__name__)


class MemoryManager:
    """
    Gestionnaire de mémoire pour l'Assistant IA.
    Implémente les commandes du Memory Tool d'Anthropic.
    """

    def __init__(self, base_path: str = "memories"):
        """
        Initialise le gestionnaire de mémoire.

        Args:
            base_path: Chemin de base pour le répertoire de mémoires
        """
        self.base_path = Path(base_path).resolve()
        self._ensure_memory_directory()
        logger.info(f"MemoryManager initialisé avec base_path: {self.base_path}")

    def _ensure_memory_directory(self):
        """Crée le répertoire de mémoires s'il n'existe pas."""
        self.base_path.mkdir(parents=True, exist_ok=True)

        # Créer la structure de sous-répertoires recommandée
        subdirs = [
            "users",
            "projects/active",
            "projects/completed",
            "knowledge_base/construction_quebec",
            "knowledge_base/pricing",
            "knowledge_base/templates",
            "client_insights",
            "system"
        ]

        for subdir in subdirs:
            (self.base_path / subdir).mkdir(parents=True, exist_ok=True)

        logger.info(f"Structure de répertoires mémoire créée dans {self.base_path}")

    def _validate_path(self, path: str) -> Path:
        """
        Valide et résout un chemin pour empêcher les attaques de traversée de répertoire.

        Args:
            path: Chemin à valider (relatif à /memories)

        Returns:
            Path: Chemin résolu et validé

        Raises:
            ValueError: Si le chemin est invalide ou dangereux
        """
        # Nettoyer le chemin
        path = path.strip()

        # Supprimer le préfixe /memories si présent
        if path.startswith('/memories'):
            path = path[len('/memories'):]
        if path.startswith('/'):
            path = path[1:]

        # Résoudre le chemin complet
        full_path = (self.base_path / path).resolve()

        # Vérifier que le chemin reste dans le répertoire de mémoires
        try:
            full_path.relative_to(self.base_path)
        except ValueError:
            raise ValueError(f"Chemin invalide: tentative d'accès en dehors du répertoire de mémoires")

        # Vérifier les patterns dangereux
        dangerous_patterns = ['..', '~', '$']
        if any(pattern in str(path) for pattern in dangerous_patterns):
            raise ValueError(f"Chemin contient des caractères dangereux")

        return full_path

    def execute_command(self, command: str, **params) -> Dict[str, Any]:
        """
        Exécute une commande Memory Tool.

        Args:
            command: Commande à exécuter (view, create, str_replace, insert, delete, rename)
            **params: Paramètres de la commande

        Returns:
            Dict contenant le résultat de la commande
        """
        try:
            if command == "view":
                return self._view(params.get("path"), params.get("view_range"))
            elif command == "create":
                return self._create(params.get("path"), params.get("file_text"))
            elif command == "str_replace":
                return self._str_replace(
                    params.get("path"),
                    params.get("old_str"),
                    params.get("new_str")
                )
            elif command == "insert":
                return self._insert(
                    params.get("path"),
                    params.get("insert_line"),
                    params.get("insert_text")
                )
            elif command == "delete":
                return self._delete(params.get("path"))
            elif command == "rename":
                return self._rename(params.get("old_path"), params.get("new_path"))
            else:
                return {"error": f"Commande inconnue: {command}"}

        except Exception as e:
            logger.error(f"Erreur lors de l'exécution de la commande {command}: {e}")
            return {"error": str(e)}

    def _view(self, path: str, view_range: Optional[List[int]] = None) -> Dict[str, Any]:
        """
        Affiche le contenu d'un répertoire ou d'un fichier.

        Args:
            path: Chemin à afficher
            view_range: Plage de lignes optionnelle [start, end]

        Returns:
            Dict avec le contenu
        """
        full_path = self._validate_path(path)

        if full_path.is_dir():
            # Lister le contenu du répertoire
            items = []
            for item in sorted(full_path.iterdir()):
                rel_path = item.relative_to(self.base_path)
                if item.is_dir():
                    items.append(f"📁 {rel_path}/")
                else:
                    size = item.stat().st_size
                    items.append(f"📄 {rel_path} ({size} bytes)")

            content = f"Directory: /memories/{full_path.relative_to(self.base_path)}\n"
            content += "\n".join(items) if items else "(empty)"

            return {"content": content}

        elif full_path.is_file():
            # Lire le contenu du fichier
            with open(full_path, 'r', encoding='utf-8') as f:
                lines = f.readlines()

            if view_range:
                start, end = view_range
                lines = lines[start - 1:end]  # Indexation à partir de 1

            content = ''.join(lines)
            return {"content": content}

        else:
            return {"error": f"Le chemin n'existe pas: {path}"}

    def _create(self, path: str, file_text: str) -> Dict[str, Any]:
        """
        Crée ou écrase un fichier.

        Args:
            path: Chemin du fichier
            file_text: Contenu du fichier

        Returns:
            Dict avec le résultat
        """
        full_path = self._validate_path(path)

        # Créer les répertoires parents si nécessaire
        full_path.parent.mkdir(parents=True, exist_ok=True)

        # Écrire le fichier
        with open(full_path, 'w', encoding='utf-8') as f:
            f.write(file_text)

        logger.info(f"Fichier créé: {full_path}")
        return {"content": f"Fichier créé avec succès: /memories/{full_path.relative_to(self.base_path)}"}

    def _str_replace(self, path: str, old_str: str, new_str: str) -> Dict[str, Any]:
        """
        Remplace une chaîne dans un fichier.

        Args:
            path: Chemin du fichier
            old_str: Chaîne à remplacer
            new_str: Nouvelle chaîne

        Returns:
            Dict avec le résultat
        """
        full_path = self._validate_path(path)

        if not full_path.is_file():
            return {"error": f"Fichier non trouvé: {path}"}

        # Lire le contenu
        with open(full_path, 'r', encoding='utf-8') as f:
            content = f.read()

        # Vérifier que old_str existe
        if old_str not in content:
            return {"error": f"Chaîne non trouvée dans le fichier: {old_str}"}

        # Remplacer
        new_content = content.replace(old_str, new_str, 1)  # Une seule occurrence

        # Écrire
        with open(full_path, 'w', encoding='utf-8') as f:
            f.write(new_content)

        logger.info(f"Remplacement effectué dans: {full_path}")
        return {"content": "Remplacement effectué avec succès"}

    def _insert(self, path: str, insert_line: int, insert_text: str) -> Dict[str, Any]:
        """
        Insère du texte à une ligne spécifique.

        Args:
            path: Chemin du fichier
            insert_line: Numéro de ligne (indexation à partir de 1)
            insert_text: Texte à insérer

        Returns:
            Dict avec le résultat
        """
        full_path = self._validate_path(path)

        if not full_path.is_file():
            return {"error": f"Fichier non trouvé: {path}"}

        # Lire les lignes
        with open(full_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()

        # Insérer le texte
        lines.insert(insert_line - 1, insert_text)

        # Écrire
        with open(full_path, 'w', encoding='utf-8') as f:
            f.writelines(lines)

        logger.info(f"Insertion effectuée dans: {full_path} à la ligne {insert_line}")
        return {"content": f"Texte inséré à la ligne {insert_line}"}

    def _delete(self, path: str) -> Dict[str, Any]:
        """
        Supprime un fichier ou répertoire.

        Args:
            path: Chemin à supprimer

        Returns:
            Dict avec le résultat
        """
        full_path = self._validate_path(path)

        if not full_path.exists():
            return {"error": f"Le chemin n'existe pas: {path}"}

        if full_path.is_file():
            full_path.unlink()
            logger.info(f"Fichier supprimé: {full_path}")
            return {"content": f"Fichier supprimé: /memories/{full_path.relative_to(self.base_path)}"}

        elif full_path.is_dir():
            # Supprimer récursivement
            import shutil
            shutil.rmtree(full_path)
            logger.info(f"Répertoire supprimé: {full_path}")
            return {"content": f"Répertoire supprimé: /memories/{full_path.relative_to(self.base_path)}"}

    def _rename(self, old_path: str, new_path: str) -> Dict[str, Any]:
        """
        Renomme ou déplace un fichier/répertoire.

        Args:
            old_path: Ancien chemin
            new_path: Nouveau chemin

        Returns:
            Dict avec le résultat
        """
        full_old_path = self._validate_path(old_path)
        full_new_path = self._validate_path(new_path)

        if not full_old_path.exists():
            return {"error": f"Le chemin source n'existe pas: {old_path}"}

        # Créer les répertoires parents si nécessaire
        full_new_path.parent.mkdir(parents=True, exist_ok=True)

        # Renommer
        full_old_path.rename(full_new_path)

        logger.info(f"Renommé: {full_old_path} -> {full_new_path}")
        return {"content": f"Renommé avec succès: {old_path} -> {new_path}"}

    def get_storage_info(self) -> Dict[str, Any]:
        """
        Retourne des informations sur le stockage mémoire.

        Returns:
            Dict avec les statistiques
        """
        total_files = 0
        total_size = 0

        for item in self.base_path.rglob('*'):
            if item.is_file():
                total_files += 1
                total_size += item.stat().st_size

        return {
            "base_path": str(self.base_path),
            "total_files": total_files,
            "total_size_bytes": total_size,
            "total_size_mb": round(total_size / (1024 * 1024), 2)
        }

    def cleanup_old_memories(self, days: int = 90):
        """
        Nettoie les mémoires non accédées depuis X jours.

        Args:
            days: Nombre de jours d'inactivité
        """
        import time
        cutoff_time = time.time() - (days * 86400)
        deleted_count = 0

        for item in self.base_path.rglob('*'):
            if item.is_file():
                if item.stat().st_atime < cutoff_time:
                    item.unlink()
                    deleted_count += 1
                    logger.info(f"Mémoire expirée supprimée: {item}")

        logger.info(f"Nettoyage terminé: {deleted_count} fichiers supprimés")
        return deleted_count


# Fonction utilitaire pour créer des mémoires initiales
def create_initial_knowledge_base(memory_manager: MemoryManager):
    """
    Crée une base de connaissances initiale pour Constructo AI.

    Args:
        memory_manager: Instance du MemoryManager
    """
    # Guide de bienvenue
    welcome_content = """# Guide du Memory Tool - Constructo AI

## Ce système de mémoire permet à l'assistant de:
- Se souvenir de vos préférences
- Apprendre vos workflows
- Conserver les connaissances métier
- Maintenir le contexte entre les sessions

## Structure des répertoires:
- /memories/users/ : Préférences utilisateur
- /memories/projects/ : Contexte des projets
- /memories/knowledge_base/ : Connaissances métier
- /memories/client_insights/ : Informations clients
- /memories/system/ : Configuration système

## Bonnes pratiques:
1. L'assistant vérifiera toujours sa mémoire avant de commencer
2. Les informations importantes seront automatiquement sauvegardées
3. Vous pouvez demander à l'assistant de "se souvenir" de quelque chose
4. Les données sensibles NE SONT PAS stockées en mémoire
"""

    memory_manager.execute_command("create", path="README.md", file_text=welcome_content)

    # Template de préférences utilisateur
    user_prefs_template = """<user_preferences>
    <communication>
        <style><!-- détaillé, concis, technique --></style>
        <language>Français (Québec)</language>
    </communication>

    <construction_preferences>
        <default_materials>
            <!-- Matériaux préférés pour différents types de projets -->
        </default_materials>
        <standard_clauses>
            <!-- Clauses contractuelles standard -->
        </standard_clauses>
    </construction_preferences>

    <workflows>
        <!-- Workflows personnalisés mémorisés -->
    </workflows>
</user_preferences>
"""

    memory_manager.execute_command(
        "create",
        path="knowledge_base/templates/user_preferences_template.xml",
        file_text=user_prefs_template
    )

    # Guide des normes RBQ (exemple)
    rbq_guide = """<normes_rbq_quebec>
    <version>2025</version>

    <licences_requises>
        <entrepreneur_general>
            <description>Licence requise pour travaux > 25 000$</description>
            <sous_categories>
                <!-- Détails des sous-catégories -->
            </sous_categories>
        </entrepreneur_general>
    </licences_requises>

    <exigences_documentation>
        <contrat>
            <!-- Éléments obligatoires dans un contrat -->
        </contrat>
        <garanties>
            <!-- Garanties légales à respecter -->
        </garanties>
    </exigences_documentation>

    <notes>
        <!-- L'assistant complétera ces informations au fur et à mesure -->
    </notes>
</normes_rbq_quebec>
"""

    memory_manager.execute_command(
        "create",
        path="knowledge_base/construction_quebec/normes_rbq.xml",
        file_text=rbq_guide
    )

    logger.info("Base de connaissances initiale créée")


if __name__ == "__main__":
    # Test du MemoryManager
    print("Test du MemoryManager...")

    mm = MemoryManager("memories_test")

    # Tester création
    result = mm.execute_command(
        "create",
        path="test.txt",
        file_text="Hello, Memory Tool!\nCeci est un test."
    )
    print(f"Création: {result}")

    # Tester view
    result = mm.execute_command("view", path="")
    print(f"View directory: {result}")

    # Tester view fichier
    result = mm.execute_command("view", path="test.txt")
    print(f"View file: {result}")

    # Tester str_replace
    result = mm.execute_command(
        "str_replace",
        path="test.txt",
        old_str="test",
        new_str="TEST"
    )
    print(f"Replace: {result}")

    # Info storage
    info = mm.get_storage_info()
    print(f"Storage info: {info}")

    print("\n✅ Tests terminés!")
