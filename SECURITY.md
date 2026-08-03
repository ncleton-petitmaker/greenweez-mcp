# Security policy

Signalez une vulnérabilité de façon privée au mainteneur du dépôt. N’incluez jamais de cookies, mots de passe, codes 2FA, clés API, adresse de livraison ni capture brute de compte dans un ticket.

Le connecteur n’accepte qu’un service Camofox HTTP situé sur loopback. Sa clé est uniquement lue depuis `GREENWEEZ_CAMOFOX_API_KEY`, n’est jamais affichée ni stockée, et doit rester hors Git avec des permissions privées.

Le MCP ne stocke jamais le mot de passe Greenweez. Le bundle de session portable ne conserve qu’une liste fermée de cookies nécessaires à NextAuth, au panier et au passage Cloudflare, chiffrés en AES-256-GCM ; sa clé et le bundle sont écrits en `0600`. Ensemble, ces deux fichiers donnent accès à la session et doivent être traités comme un secret de compte : transfert privé uniquement, aucune inclusion dans Git, des logs, une conversation ou un paquet npm.

Les confirmations de panier sont enregistrées séparément en `0600`, isolées par identifiant local Camofox, expirent après deux minutes et sont consommées au premier essai. Le jeton brut n’est jamais stocké : seul son condensat SHA-256 l’est. Les fichiers de verrou empêchent deux mutations concurrentes d’écrire le même panier.

Le client GraphQL ne demande que le panier minimal. Le jeton d’accès, le jeton de panier et l’identifiant de session Algolia sont obtenus dans la page locale au moment de l’appel, ne font partie d’aucune sortie MCP et ne sont jamais journalisés. Les réponses publiques excluent les identifiants internes de ligne, l’identifiant de commande, les adresses et les données de paiement.
