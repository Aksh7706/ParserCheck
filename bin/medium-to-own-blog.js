#!/usr/bin/env node

const { spawn } = require('child_process')
const inquirer = require('inquirer')
const ora = require('ora')
const JSZip = require('jszip')
const fs = require('fs-extra')
const { getProfile } = require('../lib/get-profile')
const { getMarkdownFromPost } = require('../lib/generate-md')
const { addGatsbyFiles } = require('../lib/add-gatsby-files')
const { exec, withOutputPath } = require('../lib/utils')

// eslint-disable-next-line no-console
console.log(`    -------------------------

Hello there!

Let's move your Medium content to your very own website.
First of all, you need to download your medium content.

1. Head over https://medium.com/me/export
2. Click on the "Download your information" button

In a bit, you will receive an email from Medium with a link to "Download your archive".
Download it and drag-and-drop the resulting zip file here.
`)

let spinner
let profile = {}

inquirer
  .prompt([
    {
      name: 'archivePath',
      message: 'Path to the Medium archive',
    },
  ])
  .then(({ archivePath }) => {
    spinner = ora('Parsing Medium content').start()
    return fs.readFile(archivePath.trim())
  })
  .then(body => {
    return JSZip.loadAsync(body)
  })
  .then(zip => {
    if (!zip.file('profile/profile.html')) {
      throw new Error(
        'It seems that we cannot find your profile in the Medium archive. Are you sure you gave the right path?\nIf so, please open an issue here: https://github.com/mathieudutour/medium-to-own-blog/issues/new.'
      )
    }

    spinner.succeed('Parsed Medium content')
    spinner.start('Parsing the Medium profile')

    return getProfile(zip)
      .then(_profile => {
        profile = _profile
      })
      .then(() => zip)
  })
  .then(zip => {
    spinner.succeed('Parsed the Medium profile')
    spinner.start('Parsing the Medium posts')
    return zip.file(/^posts/).reduce((p, zippedPost, index, array) => {
      return p
        .then(() => {
          spinner.start(
            `Parsing the Medium posts [${index + 1}/${array.length}]`
          )
        })
        .then(() => zippedPost.async('text'))
        .then(content => getMarkdownFromPost(profile, content, zippedPost.name))
    }, Promise.resolve())
  })
  .then(() => {
    console.warn(`

⚠️  Due to recent changes in Medium, we cannot access the posts' categories. You might want to touch them up manually.
    `)
    spinner.succeed('Parsed the Medium posts')
    spinner.start('Preparing the Gatsby project')

    return addGatsbyFiles(profile)
  })
  .then(() => {
    spinner.succeed('Prepared the Gatsby project')
    spinner.stop()

    // eslint-disable-next-line no-console
    console.log(`
    -------------------------

Yay, your blog is ready!
Now let's work on putting it online.

GitHub is a free platform to host code online.

1. Head over https://github.com/new and create a new repository.
   Do NOT create it with a license or readme - otherwise issues will arise later.
2. Copy paste the URL of your new repository here
`)
    return inquirer.prompt([
      {
        name: 'repoURL',
        message: 'URL of the repository',
      },
    ])
  })
  .then(({ repoURL }) => {
    repoURL = repoURL.trim()
    if (!repoURL) {
      throw new Error(`
Looks like the repository's URL is empty.
You can still use the generated project as a normal Gatsby project.

You will find some information about the generated project in its README.

Happy writing!`)
    }

    spinner.start('Updating the project to use the repository URL')

    const remoteURL = repoURL

    // handle if passed a git url
    if (repoURL.match(/^git@github.com:.*/i)) {
      repoURL = repoURL.replace(/^git@github.com:.*/i, 'https://github.com/')
    }
    // handle if passed url ending with .git (GitHub handle both seamlessly)
    repoURL = repoURL.replace(/\.git$/i, '')

    return Promise.all([
      fs
        .readFile(withOutputPath(profile, './package.json'), 'utf8')
        .then(content =>
          fs.writeFile(
            withOutputPath(profile, './package.json'),
            content.replace(/{{ githubURL }}/g, repoURL),
            'utf8'
          )
        ),
      fs
        .readFile(withOutputPath(profile, './config.js'), 'utf8')
        .then(content =>
          fs.writeFile(
            withOutputPath(profile, './config.js'),
            content.replace(/{{ githubURL }}/g, repoURL),
            'utf8'
          )
        ),
    ]).then(() => {})
  })
  .then(() => {
    spinner.succeed('Updated the project to use the repository URL')
    spinner.stop()

    // eslint-disable-next-line no-console
    console.log(
      'Pushing the code for your blog to GitHub (you might be prompted for your GitHub identifiers)...\n'
    )
    return new Promise((resolve, reject) => {
      const child = spawn('git', ['push', 'origin', 'master'], {
        cwd: withOutputPath(profile),
        stdio: 'inherit',
      })

      child.on('error', () => reject())
      child.on('close', () => resolve())
      child.on('exit', () => resolve())
    })
  })
  .then(() => {
    // eslint-disable-next-line no-console
    console.log(`

    -------------------------

Now that the code for your blog is online,
we need to configure how it will be deployed.

Netlify is hosting your personal project for free.

1. Head over https://app.netlify.com/start
2. Connect with GitHub
3. Pick the repository you just created
4. Click on the big green "Deploy Site" button

Netlify probably gave a funny name to your project,
like friendly-keller-0b06be or something,
but you can choose one by going to the "Site Settings"
and clicking on "Change site name".

5. Copy paste the URL of the Netlify deployment here (not the URL of Netlify dashboard)
`)
    return inquirer.prompt([
      {
        name: 'publicURL',
        message: 'URL of the blog',
      },
    ])
  })
  .then(({ publicURL }) => {
    publicURL = publicURL.trim()
    if (!publicURL) {
      throw new Error(`
Looks like the blog's URL is empty.
You can still use the generated project as a normal Gatsby project.

You will find some information about the generated project in its README.

Happy writing!`)
    }

    spinner.start("Updating the project to use the blog's URL")

    return fs
      .readFile(withOutputPath(profile, './config.js'), 'utf8')
      .then(content =>
        fs.writeFile(
          withOutputPath(profile, './config.js'),
          content.replace(/http:\/\/localhost:8000/g, publicURL),
          'utf8'
        )
      )
      .then(() =>
        exec(`git add . && git commit -m "update config to use blog's URL"`, {
          cwd: withOutputPath(profile),
        })
      )
  })
  .then(() => {
    spinner.succeed("Updated the project to use the blog's URL")
    spinner.stop()

    // eslint-disable-next-line no-console
    console.log(
      'Pushing the code for your blog to GitHub (you might be prompted for your GitHub identifiers)...\n'
    )
    return new Promise((resolve, reject) => {
      const child = spawn('git', ['push', 'origin', 'master'], {
        cwd: withOutputPath(profile),
        stdio: 'inherit',
      })

      child.on('error', () => reject())
      child.on('close', () => resolve())
      child.on('exit', () => resolve())
    })
  })
  .then(() => {
    // eslint-disable-next-line no-console
    console.log(`
    -------------------------

Your blog is ready to go! 🙌

We created a folder called "${profile.mediumUsername}-blog" with
everything needed inside.

Your blog posts are in the "content" sub-folder but the first thing
you will want to edit is the "config.js" file. It contains
a few values like your bio or your social media links that you should edit.

For more information, you can check the guides on
https://github.com/mathieudutour/medium-to-own-blog/master/tree/master/docs.

Happy blogging!
...


`)
  })
  .then(() => process.exit(0))
  .catch(err => {
    if (spinner) {
      spinner.fail()
    }
    // eslint-disable-next-line no-console
    console.log()
    // eslint-disable-next-line no-console
    console.error(err)
    process.exit(1)
  })
