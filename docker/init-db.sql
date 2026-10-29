-- A aplicação conecta com um usuário dono dos próprios bancos, não com o superusuário.
-- CREATEDB só em dev: o `prisma migrate dev` cria um banco sombra temporário.
-- Produção roda `prisma migrate deploy`, que não precisa disso.
CREATE ROLE belezaour WITH LOGIN CREATEDB PASSWORD 'belezaour';
CREATE DATABASE belezaour OWNER belezaour;
CREATE DATABASE belezaour_test OWNER belezaour;

-- A migration também cria btree_gist (extensão "trusted"); aqui só adianta o passo.
\connect belezaour
CREATE EXTENSION IF NOT EXISTS btree_gist;
\connect belezaour_test
CREATE EXTENSION IF NOT EXISTS btree_gist;
