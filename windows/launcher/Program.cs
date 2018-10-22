using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Data;
using System.Drawing;
using System.Text;
using System.Linq;
using System.Threading;
using System.Windows.Forms;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using Microsoft.Win32;



namespace StacksLauncher
{
    public partial class Form1 : Form
    {
        private NotifyIcon sysTrayIcon;
        private ContextMenu sysTrayMenu;

        private Process mongo;
        private Process meteor;

        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new Form1());
        }

        public Form1()
        {
            sysTrayMenu = new ContextMenu();
            sysTrayMenu.MenuItems.Add("Launch Stacks in Browser", BrowserLaunch);
            sysTrayMenu.MenuItems.Add("Exit Stacks", OnExit); 
            sysTrayIcon = new NotifyIcon();
            sysTrayIcon.Text = "Stacks";
            sysTrayIcon.Icon = Properties.Resources.favicon;
            sysTrayIcon.ContextMenu = sysTrayMenu;
            sysTrayIcon.Visible = true;

            mongo = LaunchMongo();

            // Wait for TCP connectivity ...
            TcpClient mongoClient = new TcpClient();
            int retries = 10;
            do { mongoClient.Connect("127.0.0.1", 24472); Thread.Sleep(1000); retries--; } while (retries > 0 && !mongoClient.Connected);
            if (!mongoClient.Connected)
            {
                mongo.Kill();
                mongo.WaitForExit();
                MessageBox.Show("Timeout waiting for MongoDB to start", "Stacks Error", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                sysTrayIcon.Visible = false;
                Application.Exit();
            }
            mongoClient.Close();

            meteor = LaunchMeteor();

            string[] args = Environment.GetCommandLineArgs();
            if (args.Length < 2 || args[1] != "nobrowser" )
            {
                TcpClient meteorClient = new TcpClient();
                retries = 10;
                do { meteorClient.Connect("127.0.0.1", 4472); Thread.Sleep(1000); retries--; } while (retries > 0 && !meteorClient.Connected);
                if (!meteorClient.Connected)
                {
                    mongo.Kill();
                    mongo.WaitForExit();
                    meteor.Kill();
                    meteor.WaitForExit();
                    MessageBox.Show("Timeout waiting for Meteor to start", "Stacks Error", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    sysTrayIcon.Visible = false;
                    Application.Exit();
                }
                meteorClient.Close();
                BrowserLaunch(null,null);
            }
        }

        protected override void OnLoad(EventArgs e)
        { 
            Visible = false;
            ShowInTaskbar = false;
            base.OnLoad(e);
        }

        private void OnExit(object sender, EventArgs e)
        {
            meteor.Kill();
            meteor.WaitForExit();

            mongo.Kill();
            mongo.WaitForExit();

            sysTrayIcon.Visible = false;
            Application.Exit();
        }

        private void BrowserLaunch(object sender, EventArgs e)
        {
            System.Diagnostics.Process.Start("http://127.0.0.1:4472");
        } 

        static Process LaunchMongo()
        {
            ProcessStartInfo startInfo = new ProcessStartInfo();
            startInfo.CreateNoWindow = true;
            startInfo.UseShellExecute = false;
            startInfo.FileName = "mongod.exe";
            startInfo.WindowStyle = ProcessWindowStyle.Hidden;
            //string dbDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "stacks");
            //startInfo.Arguments = "--quiet --port 24472 --dbpath " + dbDir;
            startInfo.Arguments = "--quiet --port 24472 --dbpath db";
            return Process.Start(startInfo);
        }

        static Process LaunchMeteor()
        {
            ProcessStartInfo startInfo = new ProcessStartInfo();
            startInfo.CreateNoWindow = true;
            startInfo.UseShellExecute = false;
            startInfo.FileName = "node.exe";
            startInfo.WorkingDirectory = "meteor";
            startInfo.WindowStyle = ProcessWindowStyle.Hidden;
            startInfo.EnvironmentVariables["MONGO_URL"] = "mongodb://127.0.0.1:24472";
            startInfo.EnvironmentVariables["ROOT_URL"] = "http://127.0.0.1:4472";
            startInfo.EnvironmentVariables["PORT"] = "4472";
            startInfo.Arguments = "main.js --scripts-prepend-node-path";
            return Process.Start(startInfo);
        }
    }
}
