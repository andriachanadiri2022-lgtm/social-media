# Little Social

A small social app built with React, Vite, and Supabase. It includes email/password sign up and sign in, editable profiles, a shared post feed, and comments.

## Run locally

1. Create a Supabase project.
2. In the Supabase SQL Editor, run [`supabase/schema.sql`](./supabase/schema.sql).
3. Copy `.env.example` to `.env.local` and add your project's URL and publishable key. You can find both in your Supabase project's API settings.
4. In a terminal, run:

   ```sh
   cd app
   npm install
   npm run dev
   ```

5. Open the local URL printed by Vite.

The publishable key is intended for browser use; Row Level Security in the schema protects user data. **Never put a Supabase secret/service-role key in this app or in GitHub.**

## Deploy to GitHub Pages

1. Create an empty GitHub repository. From the project folder containing `.github` and `app`, push the project (replace the URL with your repository):

   ```sh
   git init
   git add .
   git commit -m "Add Little Social app"
   git branch -M main
   git remote add origin https://github.com/YOUR-NAME/YOUR-REPOSITORY.git
   git push -u origin main
   ```

2. In the repository, open **Settings → Secrets and variables → Actions → Variables** and add repository variables named `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. The publishable key is intended for browser use; never store a Supabase secret/service-role key in the app.
3. In **Settings → Pages**, set the build and deployment source to **GitHub Actions**.
4. In Supabase, open **Authentication → URL Configuration**. Set **Site URL** to your GitHub Pages URL (for example, `https://your-name.github.io/your-repository/`) and add that same URL to the allowed redirect URLs. For local signup confirmations, also allow `http://localhost:5173/**` and `http://127.0.0.1:5173/**`.
5. Push a commit to `main` or run the **Deploy to GitHub Pages** workflow manually from the Actions tab. The deployed URL appears in the workflow run.

The Vite build uses relative asset paths, so it works on a project GitHub Pages URL without hard-coding the repository name.
